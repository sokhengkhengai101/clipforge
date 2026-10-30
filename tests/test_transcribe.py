"""Test សម្រាប់ pipeline/transcribe.py.

Test ភាគច្រើនមិន load Whisper ទេ (យឺត + ត្រូវ download 1.5GB) — យើងប្រើ `monkeypatch`
ដើម្បីជំនួស function ពិតដោយ function សាកល្បង។ នោះហៅថា "mocking"។
Test ដែលប្រើ model ពិតមាន mark `slow` ហើយ skip តាម default។
"""

import json
from pathlib import Path

import pytest

import config
from pipeline import transcribe as T

FIXTURES = Path(__file__).parent / "fixtures"


def fake_transcript(device: str = "cuda") -> T.Transcript:
    """Transcript សាកល្បងតូចមួយ (មិនហៅ Whisper)."""
    words = [
        T.Word(word="hello", start=0.0, end=0.4, probability=0.95),
        T.Word(word="world", start=0.4, end=0.9, probability=0.91),
    ]
    seg = T.Segment(id=0, start=0.0, end=0.9, text="hello world", words=words)
    return T.Transcript(language="en", language_probability=0.99, duration=0.9,
                        model="small", device=device, segments=[seg])


# ---------- cache round-trip ----------

def test_save_then_load_gives_same_data(tmp_path):
    original = fake_transcript()
    path = T.save_transcript(original, tmp_path / "transcript.json")
    loaded = T.load_transcript(path)

    assert loaded == original                       # dataclass ប្រៀបធៀបតាមតម្លៃ
    assert loaded.segments[0].words[1].word == "world"
    assert loaded.word_count() == 2
    assert loaded.text == "hello world"


def test_saved_json_is_readable_utf8(tmp_path):
    """JSON ត្រូវអានបានដោយមនុស្ស (indent + មិន escape អក្សរ)."""
    path = T.save_transcript(fake_transcript(), tmp_path / "t.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["cache_version"] == T.CACHE_VERSION
    assert data["segments"][0]["words"][0]["start"] == 0.0


def test_load_missing_file_returns_none(tmp_path):
    assert T.load_transcript(tmp_path / "គ្មាន.json") is None


def test_load_corrupt_json_returns_none(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{ នេះមិនមែន JSON", encoding="utf-8")
    assert T.load_transcript(bad) is None           # ត្រូវ return None មិនមែន crash


def test_load_old_cache_version_returns_none(tmp_path):
    path = T.save_transcript(fake_transcript(), tmp_path / "t.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    data["cache_version"] = 999                     # ធ្វើដូចជា cache ពី version ផ្សេង
    path.write_text(json.dumps(data), encoding="utf-8")
    assert T.load_transcript(path) is None


# ---------- cache behaviour ក្នុង transcribe() ----------

def test_cache_hit_does_not_load_whisper(tmp_path, monkeypatch):
    """បើ cache មាន យើងមិនត្រូវ load model ទេ — នេះជាចំណុចសំខាន់នៃ cache."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"not a real wav")
    cache = tmp_path / "transcript.json"
    T.save_transcript(fake_transcript(), cache)

    def must_not_be_called(*args, **kwargs):
        raise AssertionError("Whisper ត្រូវបាន load ទោះជាមាន cache!")

    monkeypatch.setattr(T, "_transcribe_with", must_not_be_called)
    result = T.transcribe(wav, cache)
    assert result.text == "hello world"


def test_force_bypasses_cache(tmp_path, monkeypatch):
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    cache = tmp_path / "transcript.json"
    T.save_transcript(fake_transcript(), cache)

    calls = []

    def fake_run(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        calls.append(device)
        return fake_transcript(device)

    monkeypatch.setattr(T, "_transcribe_with", fake_run)
    T.transcribe(wav, cache, force=True)
    assert calls, "force=True ត្រូវ transcribe ថ្មី"


def test_gpu_failure_falls_back_to_cpu(tmp_path, monkeypatch):
    """បើ GPU បរាជ័យ (VRAM/cuDNN) ត្រូវសាក CPU វិញ មិនមែន crash."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    tried = []

    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))

    def fail_on_gpu(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        tried.append(device)
        if device == "cuda":
            raise RuntimeError("cuDNN failed to initialize (សាកល្បង)")
        return fake_transcript("cpu")

    monkeypatch.setattr(T, "_transcribe_with", fail_on_gpu)
    result = T.transcribe(wav, None)

    assert tried == ["cuda", "cpu"]                 # សាក GPU មុន រួច CPU
    assert result.device == "cpu"


def test_both_devices_fail_raises_clear_error(tmp_path, monkeypatch):
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")

    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))

    def always_fail(*args, **kwargs):
        raise RuntimeError("ខូចទាំងអស់")

    monkeypatch.setattr(T, "_transcribe_with", always_fail)
    with pytest.raises(T.TranscribeError, match="GPU និង CPU"):
        T.transcribe(wav, None)


def test_missing_wav_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        T.transcribe(tmp_path / "គ្មាន.wav", None)


# ---------- test ពិត (slow) ----------

@pytest.mark.slow
def test_real_whisper_on_sample(tmp_path):
    """Run Whisper ពិតលើ clip ខ្លី — ត្រូវការ model download. Run: pytest -m slow"""
    from pipeline.audio import extract_audio

    video = FIXTURES / "sample_5s.mp4"
    wav = extract_audio(video, tmp_path / "audio.wav")
    result = T.transcribe(wav, tmp_path / "transcript.json", model_name="tiny")

    assert result.duration > 0
    assert result.model == "tiny"
    # sample_5s គ្មានពាក្យនិយាយ ដូច្នេះមិនពិនិត្យអត្ថបទ — គ្រាន់តែថាវារត់ចប់ដោយគ្មាន error
    assert (tmp_path / "transcript.json").is_file()


# ---------- អាន WAV ដោយខ្លួនយើង (ជំនួស PyAV) ----------

def test_load_wav_mono_16k(tmp_path):
    """WAV ពី audio.py ត្រូវអានបានជា float32 array ក្នុងចន្លោះ [-1, 1]."""
    from pipeline.audio import extract_audio

    wav = extract_audio(FIXTURES / "sample_5s.mp4", tmp_path / "audio.wav")
    audio = T.load_wav_mono_16k(wav)

    assert audio.dtype.name == "float32"
    assert audio.ndim == 1                                    # mono = ១ វិមាត្រ
    assert abs(len(audio) / config.AUDIO_SAMPLE_RATE - 5.0) < 0.3   # ~5 វិនាទី
    assert -1.0 <= audio.min() and audio.max() <= 1.0


def test_load_wav_wrong_format_raises(tmp_path):
    """WAV 44.1kHz stereo ត្រូវបាន error ច្បាស់ មិនឲ្យ Whisper ទទួល data ខុស."""
    import subprocess

    bad = tmp_path / "bad.wav"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-ar", "44100", "-ac", "2", str(bad)],
        check=True,
    )
    with pytest.raises(T.TranscribeError, match="WAV ខុស format"):
        T.load_wav_mono_16k(bad)


def test_on_fallback_is_called_when_gpu_fails(tmp_path, monkeypatch):
    """ការធ្លាក់ទៅ CPU ត្រូវប្រាប់អ្នកប្រើ — មិនត្រូវស្ងាត់ (bug ដែលយើងបានជួបពិត)."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    warnings = []

    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))

    def fail_on_gpu(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        if device == "cuda":
            raise RuntimeError("Library cublas64_12.dll is not found")
        return fake_transcript("cpu")

    monkeypatch.setattr(T, "_transcribe_with", fail_on_gpu)
    T.transcribe(wav, None, on_fallback=warnings.append)

    # DLL បាត់ មិនមែនអស់ VRAM -> មិនសាក GPU ម្តងមួយៗ ទៅ CPU តែម្តង
    assert len(warnings) == 1
    assert "cublas64_12.dll" in warnings[0]
    assert "CPU" in warnings[0]


def test_gpu_tries_batched_first(tmp_path, monkeypatch):
    """GPU: batched (batch 4) ជាមុន; CPU មិនដែល batched ទេ."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    calls = []

    def record(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        calls.append((device, batch_size))
        return fake_transcript(device)

    monkeypatch.setattr(T, "_transcribe_with", record)
    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))
    T.transcribe(wav, None)
    monkeypatch.setattr(config, "detect_device", lambda: ("cpu", "small", "int8"))
    T.transcribe(wav, None)

    assert calls == [("cuda", config.WHISPER_BATCH_SIZE), ("cpu", 0)]


def test_batched_out_of_memory_retries_on_gpu_one_by_one(tmp_path, monkeypatch):
    """batched អស់ VRAM -> GPU ម្តងមួយៗ (មិនទាន់ CPU), ហើយប្រាប់អ្នកប្រើ."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    calls, warnings = [], []

    def oom_when_batched(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        calls.append((device, batch_size))
        if batch_size:
            raise RuntimeError("CUDA failed with error out of memory")
        return fake_transcript(device)

    monkeypatch.setattr(T, "_transcribe_with", oom_when_batched)
    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))
    result = T.transcribe(wav, None, on_fallback=warnings.append)

    assert calls == [("cuda", config.WHISPER_BATCH_SIZE), ("cuda", 0)]
    assert result.device == "cuda"
    assert len(warnings) == 1 and "VRAM" in warnings[0]


def test_out_of_memory_twice_falls_back_to_cpu(tmp_path, monkeypatch):
    """batched និងម្តងមួយៗ អស់ VRAM ទាំងពីរ -> CPU."""
    wav = tmp_path / "audio.wav"
    wav.write_bytes(b"x")
    calls, warnings = [], []

    def oom_on_gpu(wav_path, device, model_name, compute_type, on_progress, batch_size=0):
        calls.append((device, batch_size))
        if device == "cuda":
            raise RuntimeError("CUDA failed with error out of memory")
        return fake_transcript(device)

    monkeypatch.setattr(T, "_transcribe_with", oom_on_gpu)
    monkeypatch.setattr(config, "detect_device", lambda: ("cuda", "medium", "int8_float32"))
    result = T.transcribe(wav, None, on_fallback=warnings.append)

    assert calls == [("cuda", config.WHISPER_BATCH_SIZE), ("cuda", 0), ("cpu", 0)]
    assert result.device == "cpu"
    assert len(warnings) == 2 and "CPU" in warnings[1]


# ---------- CUDA DLL setup ----------

def test_enable_cuda_dlls_returns_existing_folders():
    """ត្រឡប់បញ្ជី folder ដែលមានពិត (ឬ list ទទេបើគ្មាន GPU packages) — មិនត្រូវ crash."""
    folders = config.enable_cuda_dlls()
    assert isinstance(folders, list)
    for f in folders:
        assert f.is_dir()


def test_enable_cuda_dlls_is_idempotent():
    """ហៅច្រើនដងមិនត្រូវ load DLL ដូចគ្នាម្តងហើយម្តងទៀត."""
    first = config.enable_cuda_dlls()
    handles_after_first = len(config._CUDA_DLL_HANDLES)
    second = config.enable_cuda_dlls()
    assert first == second
    assert len(config._CUDA_DLL_HANDLES) == handles_after_first


# ---------- batched: កាត់ segment វែងជាប្រយោគ ----------

def _words(*items):
    """(word, start, end) -> [Word]."""
    return [T.Word(word=w, start=s, end=e) for w, s, e in items]


def test_split_segments_at_sentence_end_and_pause():
    """segment 26 s មួយ -> ប្រយោគ: ក្រោយ '.' (បើ >= 4 s) និងនៅ pause > 1 s."""
    words = _words((" We", 0.0, 0.5), (" start", 0.6, 4.5), (" here.", 4.6, 5.0),   # 5 s + '.' -> កាត់
                   (" Okay.", 5.2, 5.6),                                             # ខ្លី: មិនកាត់ក្រោយ '.'
                   (" then", 5.8, 6.2),                                              # pause 2 s បន្ទាប់
                   (" more", 8.2, 8.6), (" words", 8.7, 9.0))
    segment = T.Segment(id=0, start=0.0, end=9.0, text="", words=words)
    result = T.split_segments([segment])

    assert [s.text for s in result] == ["We start here.", "Okay. then", "more words"]
    assert [(s.start, s.end) for s in result] == [(0.0, 5.0), (5.2, 6.2), (8.2, 9.0)]
    assert [s.id for s in result] == [0, 1, 2]
    assert sum(len(s.words) for s in result) == len(words)   # គ្មានពាក្យបាត់


def test_split_segments_caps_long_runs_at_the_biggest_gap():
    """គ្មានវណ្ណយុត្តិ គ្មាន pause > 1 s: កាត់នៅចន្លោះធំបំផុត រហូត <= 15 s."""
    words = [T.Word(word=" w", start=i * 1.0, end=i * 1.0 + 0.5) for i in range(30)]
    words[12] = T.Word(word=" w", start=12.4, end=12.9)       # ចន្លោះធំបំផុត 0.9 s មុនពាក្យនេះ
    segment = T.Segment(id=0, start=0.0, end=29.5, text="", words=words)
    result = T.split_segments([segment])

    assert all(s.end - s.start <= T.SPLIT_MAX_SEC for s in result)
    assert result[0].words[-1].start == 11.0 and result[1].words[0].start == 12.4
    assert sum(len(s.words) for s in result) == 30


def test_split_segments_keeps_segments_without_words():
    """គ្មាន word timestamps -> មិនដឹងកាត់ត្រង់ណា: ទុកដូចដើម."""
    segment = T.Segment(id=0, start=0.0, end=26.0, text="hello", words=[])
    assert T.split_segments([segment]) == [segment]
