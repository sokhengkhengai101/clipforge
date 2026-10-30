"""ជំហាន 2 — faster-whisper: WAV -> segments + word-level timestamps.

**Word-level timestamps ជាអ្វី?** Whisper ធម្មតាប្រាប់តែថា "ប្រយោគនេះចាប់ពី 12.4s ដល់ 16.8s"។
ជាមួយ `word_timestamps=True` វាប្រាប់រាល់ **ពាក្យ** ថាចាប់ផ្តើម/ចប់ពេលណា៖
    {"word": "hiring", "start": 13.08, "end": 13.44}
យើងត្រូវការវា ២ ទី: (1) captions ដែលបំលេចពាក្យតាមពេលនិយាយ,
(2) boundaries ដើម្បីកាត់ clip កុំឲ្យកាត់ពាក់កណ្តាលពាក្យ។

Cache: លទ្ធផលទុកក្នុង output/<name>/transcript.json — run ម្តងទៀតមិន transcribe ឡើងវិញទេ
(សំខាន់ណាស់ ព្រោះ Whisper យឺត តែយើងនឹងកែ prompt របស់ highlights ច្រើនដង)។
"""

import gc
import json
import wave
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

import config

CACHE_VERSION = 1   # បើយើងប្តូររចនាសម្ព័ន្ធ JSON ថ្ងៃក្រោយ លេខនេះឡើង -> cache ចាស់ត្រូវ transcribe ថ្មី


class TranscribeError(RuntimeError):
    """Whisper load ឬ transcribe បរាជ័យ."""


# dataclass = class សម្រាប់ដាក់ data សុទ្ធ។ Python សរសេរ __init__ ជំនួសយើង។
@dataclass
class Word:
    """ពាក្យមួយ + ពេលវេលារបស់វា."""
    word: str
    start: float
    end: float
    probability: float = 0.0


@dataclass
class Segment:
    """ប្រយោគ (ឬផ្នែកប្រយោគ) មួយ + បញ្ជីពាក្យខាងក្នុង."""
    id: int
    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)


@dataclass
class Transcript:
    """លទ្ធផលពេញលេញនៃ transcription មួយ."""
    language: str
    language_probability: float
    duration: float
    model: str
    device: str
    segments: list[Segment] = field(default_factory=list)

    @property
    def text(self) -> str:
        """អត្ថបទទាំងមូលតោងគ្នា — មានប្រយោជន៍ពេល debug."""
        return " ".join(s.text.strip() for s in self.segments)

    def word_count(self) -> int:
        return sum(len(s.words) for s in self.segments)


# ---------- cache (JSON) ----------

def save_transcript(transcript: Transcript, path: Path) -> Path:
    """សរសេរ Transcript ទៅ JSON. `asdict` ប្តូរ dataclass -> dict ធម្មតា."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"cache_version": CACHE_VERSION, **asdict(transcript)}
    # ensure_ascii=False ដើម្បីកុំឲ្យអក្សរមិនមែន ASCII ប្លែងជា ሴ
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_transcript(path: Path) -> Transcript | None:
    """អាន JSON មកវិញជា Transcript. ត្រឡប់ None បើ cache គ្មាន/ខូច/ចាស់."""
    path = Path(path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None   # cache ខូច -> ធ្វើថ្មី ជាជាង crash

    if data.get("cache_version") != CACHE_VERSION:
        return None

    try:
        segments = [
            Segment(
                id=s["id"], start=s["start"], end=s["end"], text=s["text"],
                words=[Word(**w) for w in s.get("words", [])],
            )
            for s in data["segments"]
        ]
        return Transcript(
            language=data["language"],
            language_probability=data["language_probability"],
            duration=data["duration"],
            model=data["model"],
            device=data["device"],
            segments=segments,
        )
    except (KeyError, TypeError):
        return None


# ---------- Whisper ----------

def load_wav_mono_16k(wav_path: Path) -> np.ndarray:
    """អាន WAV 16kHz mono -> numpy array float32 ក្នុងចន្លោះ [-1.0, 1.0].

    **ហេតុអ្វីយើងអានខ្លួនឯង?** faster-whisper អាន audio តាម library `PyAV`,
    តែ PyAV 19 បានលុប argument ដែល faster-whisper ហៅ (`metadata_errors`) -> error។
    ដោយយើងបង្កើត WAV នេះខ្លួនឯង (16kHz mono 16-bit ធានាដោយ audio.py) ការអានវាងាយ
    ហើយ Whisper ទទួល numpy array ដោយផ្ទាល់ — រំលង PyAV ទាំងស្រុង។

    int16 មានតម្លៃ -32768..32767។ ចែកនឹង 32768 ទើបបាន float -1.0..1.0 ដែល Whisper ត្រូវការ។
    """
    with wave.open(str(wav_path), "rb") as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        if (rate, channels, width) != (config.AUDIO_SAMPLE_RATE, 1, 2):
            raise TranscribeError(
                f"WAV ខុស format: {rate}Hz {channels}ch {width * 8}bit "
                f"(ត្រូវការ {config.AUDIO_SAMPLE_RATE}Hz 1ch 16bit)"
            )
        frames = w.readframes(w.getnframes())

    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def _transcribe_with(wav_path: Path, device: str, model_name: str, compute_type: str,
                     on_progress: Callable[[float], None] | None, batch_size: int = 0) -> Transcript:
    """ការងារពិត: load model លើ `device` មួយ រួច transcribe.

    ដាក់ដោយឡែកដើម្បីឲ្យ `transcribe()` អាចសាក cuda រួចសាក cpu វិញបាន។

    `batch_size` > 0 = **batched**: VAD កាតសំឡេងជាផ្នែកៗ ហើយផ្ញើ N ផ្នែកក្នុងពេលតែមួយទៅ GPU
    (ជំនួស ផ្នែក1 -> ផ្នែក2 -> ...). លឿនជាងប្រហែល 4 ដងលើ GTX 1060 តែប្រើ VRAM ច្រើនជាង.
    """
    if device == "cuda":
        config.enable_cuda_dlls()   # ត្រូវហៅ **មុន** import faster_whisper/ctranslate2

    from faster_whisper import WhisperModel   # import ក្នុង function: load យឺត (~2s) ហេតុនេះមិនយកនៅលើ

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    audio = load_wav_mono_16k(wav_path)   # float32 array ជំនួស path -> រំលង PyAV

    # segments ជា generator — ការគណនាកើតឡើងពេលយើង loop (lazy)
    if batch_size:
        from faster_whisper import BatchedInferencePipeline

        segments_iter, info = BatchedInferencePipeline(model=model).transcribe(
            audio,
            word_timestamps=True,
            batch_size=batch_size,
            beam_size=config.WHISPER_BATCH_BEAM,   # VAD បើកស្រាប់ក្នុង batched
            language=config.WHISPER_LANGUAGE,
        )
    else:
        segments_iter, info = model.transcribe(
            audio,
            word_timestamps=True,      # <- ចំណុចសំខាន់បំផុតរបស់ជំហាននេះ
            vad_filter=True,           # VAD = Voice Activity Detection: រំលងកន្លែងស្ងាត់
            beam_size=5,
            language=config.WHISPER_LANGUAGE,
        )

    segments: list[Segment] = []
    for i, seg in enumerate(segments_iter):
        words = [
            Word(word=w.word, start=w.start, end=w.end, probability=getattr(w, "probability", 0.0))
            for w in (seg.words or [])
        ]
        segments.append(Segment(id=i, start=seg.start, end=seg.end, text=seg.text.strip(), words=words))
        if on_progress:
            on_progress(seg.end)   # ប្រាប់ខាងក្រៅថាដល់វិនាទីទីប៉ុន្មាន (សម្រាប់ progress bar)

    return Transcript(
        language=info.language,
        language_probability=round(info.language_probability, 3),
        duration=info.duration,
        model=model_name,
        device=device,
        # batched ប្រគល់ segment ~26 s -> កាត់ជាប្រយោគវិញ (ម្តងមួយៗ ផ្តល់ប្រយោគរួចហើយ)
        segments=split_segments(segments) if batch_size else segments,
    )


SPLIT_PAUSE_SEC = 1.0      # pause វែងជាងនេះចាប់ផ្តើម segment ថ្មី
SPLIT_MIN_SEC = 4.0        # ចុងប្រយោគកាត់តែពេល segment វែងយ៉ាងហោចនេះ ("Okay." មិនក្លាយជាបន្ទាត់មួយ)
SPLIT_MAX_SEC = 15.0       # segment ដែលវែងជាងនេះ កាត់នៅចន្លោះពាក្យដែលធំបំផុត
SENTENCE_END = (".", "?", "!")


def split_segments(segments: list[Segment]) -> list[Segment]:
    """កាត់ segment វែងៗជាប្រយោគ ដោយប្រើ word timestamps.

    ហេតុអ្វី: batched Whisper ប្រគល់ segment ~26 s (ផ្នែក VAD ទាំងមូល) ខណៈម្តងមួយៗផ្តល់ ~5 s
    (How-AI-agents: 80 ធៀប 434). LLM ក្នុង highlights អាន `[start - end] text` មួយបន្ទាត់ក្នុងមួយ
    segment ហើយជ្រើសម៉ោង clip ពីវា — segment 26 s មានម៉ោងតិចពេកឲ្យជ្រើស.
    កាត់: ក្រោយពាក្យដែលបញ្ចប់ដោយ . ? ! (បើ segment វែង >= 4 s ហើយ), នៅ pause > 1 s, ហើយនៅ
    ចន្លោះធំបំផុតបើនៅវែងជាង 15 s.
    """
    if any(not segment.words for segment in segments):
        return segments   # គ្មាន word timestamps -> មិនដឹងកាត់ត្រង់ណា; ទុកដូចដើម
    pieces: list[list[Word]] = []
    for segment in segments:
        current: list[Word] = []
        for i, word in enumerate(segment.words):
            current.append(word)
            following = segment.words[i + 1] if i + 1 < len(segment.words) else None
            if following is None:
                break
            sentence_done = (word.word.strip().endswith(SENTENCE_END)
                             and word.end - current[0].start >= SPLIT_MIN_SEC)
            if sentence_done or following.start - word.end > SPLIT_PAUSE_SEC:
                pieces.append(current)
                current = []
        if current:
            pieces.append(current)

    # segment ដែលនៅវែងជាង 15 s (គ្មានវណ្ណយុត្តិ): កាត់ពីរនៅចន្លោះធំបំផុត រហូតខ្លីល្មម
    short: list[list[Word]] = []
    while pieces:
        words = pieces.pop(0)
        if len(words) > 1 and words[-1].end - words[0].start > SPLIT_MAX_SEC:
            gap = max(range(1, len(words)), key=lambda k: words[k].start - words[k - 1].end)
            pieces[:0] = [words[:gap], words[gap:]]
        else:
            short.append(words)

    return [
        Segment(id=i, start=words[0].start, end=words[-1].end,
                text="".join(w.word for w in words).strip(), words=words)
        for i, words in enumerate(short)
    ]


def _attempt(wav_path: Path, device: str, model_name: str, compute_type: str,
             on_progress: Callable[[float], None] | None,
             batch_size: int) -> tuple[Transcript | None, Exception | None]:
    """សាកម្តង: (transcript, None) ឬ (None, error).

    error ត្រឡប់ **ដោយគ្មាន traceback**: traceback ចាប់ local variables របស់ `_transcribe_with`
    (រួមទាំង model ក្នុង VRAM) — បើទុកវា ការសាកម្តងទៀតនឹងអស់ VRAM ម្តងទៀត.
    """
    try:
        return _transcribe_with(wav_path, device, model_name, compute_type, on_progress,
                                batch_size=batch_size), None
    except Exception as error:
        return None, error.with_traceback(None)


def _out_of_memory(error: Exception) -> bool:
    """CUDA អស់ VRAM? (DLL បាត់ ឬ error ផ្សេង -> សាកម្តងមួយៗក៏គ្មានប្រយោជន៍)."""
    return "out of memory" in str(error).lower()


def transcribe(
    wav_path: Path,
    cache_path: Path | None = None,
    *,
    force: bool = False,
    model_name: str | None = None,
    on_progress: Callable[[float], None] | None = None,
    on_fallback: Callable[[str], None] | None = None,
) -> Transcript:
    """Transcribe WAV មួយ -> Transcript (មាន word timestamps), ជាមួយ cache + GPU fallback.

    ដំណើរការ:
      1. បើ cache មាន ហើយមិន force -> អានមកវិញភ្លាម (មិន load model ទេ)
      2. សាក GPU តាម config.detect_device() — batched (`WHISPER_BATCH_SIZE`)
      3. បើ batched អស់ VRAM -> សាក GPU ម្តងមួយៗ (beam 5)
      4. បើ GPU នៅតែបរាជ័យ (VRAM/cuBLAS/cuDNN) -> សាក CPU

    `on_fallback` ត្រូវបានហៅជាមួយ error ពី GPU ដើម្បីឲ្យ CLI ប្រាប់អ្នកប្រើ។
    ការធ្លាក់ទៅ CPU ដោយស្ងាត់គឺអាក្រក់ — អ្នកប្រើនឹងឆ្ងល់ថាហេតុអ្វីយឺតម្ល៉េះ។
    """
    wav_path = Path(wav_path)
    if not wav_path.is_file():
        raise FileNotFoundError(f"រកមិនឃើញ WAV: {wav_path}")

    if cache_path is not None and not force:
        cached = load_transcript(cache_path)
        if cached is not None:
            return cached

    device, default_model, compute_type = config.detect_device()
    model_name = model_name or default_model

    # GPU: batched ជាមុន. អស់ VRAM -> សាក GPU ម្តងមួយៗ (beam 5 ដូចមុន) -> នៅតែបរាជ័យ -> CPU.
    batch = config.WHISPER_BATCH_SIZE if device == "cuda" else 0
    transcript, gpu_error = _attempt(wav_path, device, model_name, compute_type, on_progress, batch)
    if gpu_error is not None and batch and _out_of_memory(gpu_error):
        if on_fallback:
            on_fallback(f"GPU batch {batch} អស់ VRAM -> សាកម្តងមួយៗ (យឺតជាង): {gpu_error}")
        gc.collect()   # ដោះ model ចាស់ចេញពី VRAM មុនពេល load ម្តងទៀត
        transcript, gpu_error = _attempt(wav_path, device, model_name, compute_type, on_progress, 0)

    if gpu_error is not None:
        if device == "cpu":
            raise TranscribeError(f"Whisper បរាជ័យលើ CPU: {gpu_error}") from gpu_error
        # GPU បរាជ័យ -> ធ្លាក់ទៅ CPU (model តូចជាង ដើម្បីកុំយឺតពេក)
        if on_fallback:
            on_fallback(f"GPU បរាជ័យ -> ប្តូរទៅ CPU: {gpu_error}")
        try:
            transcript = _transcribe_with(
                wav_path, "cpu", config.WHISPER_MODEL_CPU, config.WHISPER_COMPUTE_CPU, on_progress
            )
        except Exception as cpu_error:
            raise TranscribeError(
                f"Whisper បរាជ័យទាំង GPU និង CPU។\nGPU: {gpu_error}\nCPU: {cpu_error}"
            ) from cpu_error

    if cache_path is not None:
        save_transcript(transcript, cache_path)

    return transcript
