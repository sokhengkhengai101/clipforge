"""ជំហាន 1 — extract audio ពី video ទៅ WAV 16 kHz mono (FFmpeg via subprocess).

ហេតុអ្វី WAV 16 kHz mono? Whisper ត្រូវការ format នេះជាក់ស្តែង។ បើយើងផ្តល់ MP3 48 kHz
stereo វានឹងបម្លែងខ្លួនឯងម្តងទៀត = យឺត + អាចខុស។ យើងធ្វើម្តងទល់មុខឲ្យស្អាត។

`subprocess` = module Python សម្រាប់ហៅ program ក្រៅ (ដូច FFmpeg) ហើយទទួលលទ្ធផលមកវិញ។
"""

import shutil
import subprocess
from pathlib import Path

import config


class FFmpegError(RuntimeError):
    """FFmpeg បរាជ័យ — យើងបង្កើត error ប្រភេទខ្លួនឯង ដើម្បីចាប់វាបានដោយឡែក."""


def _require_ffmpeg(exe: str = "ffmpeg") -> str:
    """ពិនិត្យថា ffmpeg/ffprobe នៅក្នុង PATH មុននឹងហៅ — error ច្បាស់ជាង crash."""
    path = shutil.which(exe)
    if not path:
        raise FFmpegError(
            f"រកមិនឃើញ `{exe}` ក្នុង PATH។ Install FFmpeg រួច restart terminal។"
        )
    return path


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    """ហៅ command មួយ ហើយយក stdout/stderr មកជា text.

    capture_output=True = ចាប់ output ទុកក្នុង variable (មិនឲ្យវាហូរលើ screen).
    """
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def probe_duration(media_path: Path) -> float:
    """ប្រាប់រយៈពេល (វិនាទី) នៃ video/audio ដោយ `ffprobe`.

    ជំហានខាងមុខ (chunking, boundaries) ត្រូវដឹងរយៈពេលសរុប។
    """
    _require_ffmpeg("ffprobe")
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(media_path),
    ]
    result = _run(cmd)
    if result.returncode != 0:
        raise FFmpegError(f"ffprobe អាន {media_path.name} មិនបាន:\n{result.stderr.strip()}")
    try:
        return float(result.stdout.strip())
    except ValueError:
        raise FFmpegError(f"ffprobe ឆ្លើយមកមិនមែនជាលេខ: {result.stdout!r}")


def has_audio_stream(media_path: Path) -> bool:
    """ពិនិត្យថា file មាន audio track ឬអត់ (video គ្មានសំឡេងក៏មានដែរ)."""
    _require_ffmpeg("ffprobe")
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "a",            # a = audio streams តែប៉ុណ្ណោះ
        "-show_entries", "stream=codec_name",
        "-of", "csv=p=0",
        str(media_path),
    ]
    return bool(_run(cmd).stdout.strip())


def extract_audio(
    video_path: Path,
    out_path: Path | None = None,
    *,
    force: bool = False,
) -> Path:
    """Extract audio ពី `video_path` ទៅ WAV 16 kHz mono ហើយត្រឡប់ path នៃ WAV.

    - **មិនប៉ះ file ដើមទេ** — FFmpeg អានវាតែប៉ុណ្ណោះ, សរសេរចេញទៅ `output/`។
    - បើ WAV មានរួចហើយ នឹង skip (cache) លុះត្រាតែ `force=True`។

    `*` ក្នុង signature មានន័យថា argument ក្រោយវាត្រូវសរសេរឈ្មោះ:
        extract_audio(v, force=True)   ✅
        extract_audio(v, None, True)   ❌
    """
    video_path = Path(video_path)
    if not video_path.is_file():
        raise FileNotFoundError(f"រកមិនឃើញ video: {video_path}")

    # default: output/<ឈ្មោះ video>/audio.wav
    if out_path is None:
        out_path = config.OUTPUT_DIR / video_path.stem / "audio.wav"
    out_path = Path(out_path)

    # cache — extract ម្តងទៀតគ្មានប្រយោជន៍ ព្រោះលទ្ធផលដូចគ្នា
    if out_path.exists() and not force:
        return out_path

    if not has_audio_stream(video_path):
        raise FFmpegError(f"{video_path.name} គ្មាន audio track ទេ — Whisper មិនមានអ្វីស្តាប់។")

    # mkdir ទុកក្រោយការពិនិត្យ — បើបរាជ័យ យើងកុំទុក folder ទទេនៅក្នុង output/
    out_path.parent.mkdir(parents=True, exist_ok=True)

    _require_ffmpeg("ffmpeg")
    cmd = [
        "ffmpeg",
        "-hide_banner", "-loglevel", "error",
        "-nostdin",                               # កុំរង់ចាំ input ពី keyboard
        "-y",                                     # overwrite file ទិសដៅ
        "-i", str(video_path),                    # -i = input (អានតែប៉ុណ្ណោះ)
        "-vn",                                    # vn = video none, ទម្លាក់ video ចោល
        "-ac", str(config.AUDIO_CHANNELS),        # ac = audio channels -> 1 (mono)
        "-ar", str(config.AUDIO_SAMPLE_RATE),     # ar = audio rate -> 16000 Hz
        "-c:a", "pcm_s16le",                      # WAV 16-bit ធម្មតា (Whisper ចូលចិត្ត)
        str(out_path),
    ]
    result = _run(cmd)

    if result.returncode != 0:
        raise FFmpegError(
            f"FFmpeg បរាជ័យ (exit {result.returncode}) លើ {video_path.name}:\n"
            f"{result.stderr.strip()[-800:]}"     # យកតែ 800 តួចុងក្រោយ ឲ្យអានបាន
        )
    if not out_path.exists() or out_path.stat().st_size == 0:
        raise FFmpegError(f"FFmpeg រត់ចប់ តែ {out_path.name} ទទេ/គ្មាន។")

    return out_path
