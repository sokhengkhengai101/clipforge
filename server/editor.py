"""ទិន្នន័យសម្រាប់ screen Edit Video: ពាក្យនីមួយៗ (ពី transcript.json) និង waveform (ពី audio.wav).

ទាំងពីរអានតែ file ដែល pipeline សរសេររួច — គ្មានការគណនាលើវីដេអូដើមទេ.
"""

import json
import wave
from pathlib import Path

import config
from pipeline.transcribe import load_transcript

# គម្លាតរវាងពាក្យពីរ ដែលលើសនេះ = ស្លាក pause ក្នុង transcript (ដូចរូប OpusClip "0.46s")
PAUSE_MIN_SEC = 0.3
WAVEFORM_POINTS = 1200        # ចំណុចដែលរក្សាទុក; UI ពង្រីក/បង្រួមពីនេះ


def words_of(folder: Path) -> dict | None:
    """ពាក្យ + pause ពី `transcript.json`, ឬ `None` បើមិនទាន់ transcribe.

    `items` ជាបញ្ជីតាមលំដាប់ពេល: `{"word", "start", "end"}` ឬ `{"pause", "start", "end"}`.
    ឧ. "are" ចប់ 3.10 ហើយ "trying" ចាប់ផ្តើម 3.56 -> pause 0.46 s នៅចន្លោះ.
    """
    transcript = load_transcript(Path(folder) / "transcript.json")
    if transcript is None:
        return None
    items: list[dict] = []
    previous_end = None
    for segment in transcript.segments:
        for word in segment.words:
            if previous_end is not None and word.start - previous_end > PAUSE_MIN_SEC:
                items.append({"pause": round(word.start - previous_end, 2),
                              "start": round(previous_end, 3), "end": round(word.start, 3)})
            items.append({"word": word.word.strip(), "start": round(word.start, 3),
                          "end": round(word.end, 3)})
            previous_end = word.end
    return {"language": transcript.language, "duration": round(transcript.duration, 3),
            "items": items}


def waveform(folder: Path, points: int = WAVEFORM_POINTS) -> list[float] | None:
    """កម្ពស់ waveform 0..1 (`points` ប្រអប់) ពី `audio.wav`, ឬ `None` បើគ្មាន audio.

    **peaks**: ចែក sample ជាប្រអប់ស្មើគ្នា ហើយយកតម្លៃខ្លាំងបំផុតក្នុងប្រអប់នីមួយៗ.
    Cache ទុកក្នុង `waveform.json` ក្បែរ audio (audio ថ្មីជាង cache = គណនាម្តងទៀត).
    """
    import numpy as np

    folder = Path(folder)
    audio = folder / "audio.wav"
    if not audio.is_file():
        return None
    cache = folder / "waveform.json"
    if cache.is_file() and cache.stat().st_mtime >= audio.stat().st_mtime:
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("points") == points:
                return data["peaks"]
        except (OSError, ValueError, KeyError):
            pass

    with wave.open(str(audio), "rb") as reader:
        samples = np.frombuffer(reader.readframes(reader.getnframes()), dtype=np.int16)
    if samples.size == 0:
        return [0.0] * points
    size = max(1, samples.size // points)
    usable = samples[: size * points] if samples.size >= points else np.pad(samples, (0, points - samples.size))
    peaks = np.abs(usable.reshape(points, -1).astype(np.int32)).max(axis=1)
    top = max(1, int(peaks.max()))
    result = [round(float(value) / top, 3) for value in peaks]
    try:
        cache.write_text(json.dumps({"points": points, "peaks": result}), encoding="utf-8")
    except OSError:
        pass                      # cache មិនសំខាន់ — គណនាម្តងទៀតលើកក្រោយ
    return result


def scenes(video: Path, folder: Path | None = None) -> list[list[float]]:
    """shot របស់វីដេអូ**ដើម** `[[start, end], ...]` — scene detection ដដែលនឹង render.

    Menu Tracker "បិទ tracking សម្រាប់ scene នេះ" ត្រូវដឹងព្រំដែន scene នៅ playhead.
    Cache ក្នុង `folder/scenes.json` (ទំហំ + mtime វីដេអូ + threshold): Rhino 56 s ~2 s.
    """
    from pipeline.audio import probe_duration
    from pipeline.reframe import detect_cuts, split_into_shots

    video = Path(video)
    stat = video.stat()
    key = {"size": stat.st_size, "mtime": round(stat.st_mtime, 3), "threshold": config.SCENE_THRESHOLD}
    cache = Path(folder) / "scenes.json" if folder else None
    if cache and cache.is_file():
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("key") == key:
                return data["scenes"]
        except (OSError, ValueError, KeyError):
            pass
    length = probe_duration(video)
    shots = split_into_shots(0.0, length, detect_cuts(video, 0.0, length))
    result = [[round(a, 3), round(b, 3)] for a, b in shots]
    if cache and cache.parent.is_dir():
        try:
            cache.write_text(json.dumps({"key": key, "scenes": result}), encoding="utf-8")
        except OSError:
            pass
    return result


def _token(text: str) -> str:
    return text.strip().lower().strip(".,!?…\"'")


def cleanup_suggestions(folder: Path, pause: float = 0.5, fillers: bool = True) -> dict | None:
    """Speech cleanup: ចន្លោះដែលស្នើឲ្យកាត់ — pause វែងជាង `pause` និងពាក្យ filler. `None` = គ្មាន transcript.

    pause ត្រូវកាត់ **ទុកដង្ហើម** `CLEANUP_BREATH_SEC` សងខាង (pause 1.04 s -> កាត់ 0.80 s).
    ទាំងនេះជាការ**ស្នើ** — editor បង្ហាញវាឲ្យអ្នកពិនិត្យ មិនកាត់ដោយខ្លួនឯងទេ.
    """
    data = words_of(folder)
    if data is None:
        return None
    breath = config.CLEANUP_BREATH_SEC
    items = data["items"]
    found: list[dict] = []
    for item in items:
        if "pause" in item and item["pause"] > pause:
            start, end = item["start"] + breath, item["end"] - breath
            if end - start >= 0.05:
                found.append({"start": round(start, 3), "end": round(end, 3), "reason": "pause",
                              "text": f"{item['pause']:.2f}s"})
    if fillers:
        words = [item for item in items if "word" in item]
        index = 0
        while index < len(words):
            phrase = next((p for p in config.CLEANUP_PHRASES
                           if [_token(w["word"]) for w in words[index:index + len(p)]] == list(p)), None)
            length = len(phrase) if phrase else (1 if _token(words[index]["word"]) in config.CLEANUP_FILLERS else 0)
            if length:
                span = words[index:index + length]
                found.append({"start": span[0]["start"], "end": span[-1]["end"], "reason": "filler",
                              "text": " ".join(w["word"] for w in span)})
                index += length
            else:
                index += 1
    found.sort(key=lambda item: item["start"])
    seconds = round(sum(item["end"] - item["start"] for item in found), 2)
    return {"suggestions": found, "seconds": seconds,
            "pauses": sum(1 for item in found if item["reason"] == "pause"),
            "fillers": sum(1 for item in found if item["reason"] == "filler")}


# ---------- ទាញយក transcript (⬇ ក្នុងក្បាល transcript) ----------

TRANSCRIPT_FORMATS = ("txt", "srt")
PARAGRAPH_PAUSE_SEC = 1.0      # TXT: កថាខណ្ឌថ្មី ក្រោយ pause វែងជាងនេះ


def transcript_text(folder: Path, fmt: str, cuts: list[list[float]] | None = None,
                    inserts: list[dict] | None = None, order: list[list[float]] | None = None) -> str | None:
    """Transcript ជាអត្ថបទ **ដូចវីដេអូដែល Export នឹងចេញ**: ពាក្យដែលកាត់ត្រូវដក ហើយពេលរំកិល.

    `txt` = អត្ថបទធម្មតា (វណ្ណយុត្តិដើម), កថាខណ្ឌថ្មីក្រោយ pause > 1 s.
    `srt` = cue ដូច captions.py (`wrap_into_cues` + `build_srt`), ពេលក្នុងវីដេអូដែលកាត់រួច.
    ឧ. cuts [[9.9, 20]]: ពាក្យនៅ 25 s ក្នុងវីដេអូដើម = 14.9 s ក្នុង SRT. `None` = គ្មាន transcript.
    `inserts` (`manage.clean_inserts`): ផ្នែកដែលបន្ថែម ចូលតាមលំដាប់ដូច Export (`cuts.sequence`).
    `order` (`manage.clean_order`): ប្លុកដែលអូសប្តូរលំដាប់ (`cuts.rearrange`).
    """
    from pipeline import captions, cuts as cut_tools

    if fmt not in TRANSCRIPT_FORMATS:
        raise ValueError(f"format ត្រូវជា {', '.join(TRANSCRIPT_FORMATS)}")
    transcript = load_transcript(Path(folder) / "transcript.json")
    if transcript is None:
        return None
    clean = cut_tools.normalize([tuple(pair) for pair in cuts], transcript.duration) if cuts else []
    added = [(item["start"], item["end"], item["at"]) for item in inserts or []]
    blocks = [(start, end) for start, end in order or []]
    if clean or added or blocks:
        arranged = cut_tools.rearrange(cut_tools.keep_ranges(transcript.duration, clean), blocks)
        parts = cut_tools.sequence(arranged, added, transcript.duration)
        transcript = cut_tools.shift_transcript(transcript, parts)
    words = [word for segment in transcript.segments for word in segment.words]
    if fmt == "srt":
        return captions.build_srt(captions.wrap_into_cues(words, 0.0))
    paragraphs: list[str] = []
    current = ""
    previous_end = None
    for word in words:
        if previous_end is not None and word.start - previous_end > PARAGRAPH_PAUSE_SEC and current.strip():
            paragraphs.append(current.strip())
            current = ""
        current += word.word if word.word.startswith(" ") else f" {word.word}"
        previous_end = word.end
    if current.strip():
        paragraphs.append(current.strip())
    return "\n\n".join(paragraphs) + "\n"
