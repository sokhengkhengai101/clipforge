"""អ្វីដែលម៉ាស៊ីននេះមានពិត — hardware និង model (screen 01 · AI models).

`check_env.py` សួរសំណួរដូចគ្នា ហើយបោះពុម្ពជាអក្សរសម្រាប់មនុស្សអាននៅ terminal.
ទីនេះយើងឆ្លើយជា JSON សម្រាប់ UI. ហេតុអ្វីមិនហៅ `check_env.py` ត្រង់? ព្រោះវា
`print` រួចត្រឡប់តែចំនួនបរាជ័យ — យើងត្រូវការ **តម្លៃ** (ប៉ុន្មាន GB, ឈ្មោះអ្វី).
"""

import ctypes
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import config


def gpu() -> dict | None:
    """ឈ្មោះ GPU និង VRAM តាម `nvidia-smi`. `None` បើគ្មាន NVIDIA driver.

    ctranslate2 ប្រាប់តែថាមាន CUDA device ប៉ុន្មាន — វាមិនប្រាប់ឈ្មោះ ឬ VRAM ទេ,
    ហើយ VRAM ជាលេខដែលសម្រេចថា model pack ណាសម.
    """
    command = ["nvidia-smi", "--query-gpu=name,memory.total",
               "--format=csv,noheader,nounits"]
    try:
        done = subprocess.run(command, capture_output=True, text=True,
                              timeout=10, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    first = done.stdout.strip().splitlines()[:1]
    if not first:
        return None
    name, _, memory = first[0].partition(",")
    try:
        vram_mb = int(memory.strip())
    except ValueError:
        return None
    return {"name": name.strip(), "vram_mb": vram_mb}


def ram_mb() -> int | None:
    """RAM សរុបរបស់ម៉ាស៊ីន. Windows គ្មាន `os.sysconf` ដូច្នេះត្រូវសួរ kernel32."""
    if sys.platform == "win32":
        class Status(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong),
                        ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong),
                        ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong),
                        ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        status = Status()
        status.dwLength = ctypes.sizeof(Status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return None
        return status.ullTotalPhys // (1024 * 1024)
    try:
        return (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) // (1024 * 1024)
    except (ValueError, OSError, AttributeError):
        return None


def disk_free_mb(folder: Path) -> int | None:
    """ទំហំទំនេរលើ drive ដែល `output/` ស្ថិតនៅ — clip ធំ ហើយ model ក៏ធំដែរ."""
    try:
        return shutil.disk_usage(folder).free // (1024 * 1024)
    except OSError:
        return None


def ollama() -> dict:
    """Model ដែល `ollama pull` ទាញរួច. ដូច `check_ollama()` តែត្រឡប់តម្លៃ."""
    url = f"{config.OLLAMA_HOST}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=3) as answer:
            data = json.loads(answer.read())
    except (urllib.error.URLError, OSError, TimeoutError, json.JSONDecodeError):
        return {"reachable": False, "host": config.OLLAMA_HOST, "models": []}
    models = [{"name": item["name"], "gb": round(item.get("size", 0) / 1e9, 1)}
              for item in data.get("models", [])]
    return {"reachable": True, "host": config.OLLAMA_HOST, "models": models}


def whisper_cache() -> list[str]:
    """ទំហំ Whisper ណាខ្លះដែលទាញរួច (small, medium, large-v3...).

    `faster-whisper` ទាញ model ពី Hugging Face ហើយរក្សាក្នុង folder cache ឈ្មោះ
    `models--Systran--faster-whisper-medium`. បើ folder នោះមាន = មិនចាំបាច់ទាញ.
    """
    # huggingface_hub ប្រើ **តែមួយ** folder: env var ដែលកំណត់ឈ្នះ, បើគ្មានសោះ
    # ទើបធ្លាក់ទៅ `~/.cache`. បើយើង scan ទាំងអស់រួមបញ្ចូលគ្នា យើងនឹងរាយ model
    # ដែល Whisper មិនឃើញពិត.
    if os.environ.get("HF_HUB_CACHE"):
        root = Path(os.environ["HF_HUB_CACHE"])
    elif os.environ.get("HUGGINGFACE_HUB_CACHE"):
        root = Path(os.environ["HUGGINGFACE_HUB_CACHE"])
    elif os.environ.get("HF_HOME"):
        root = Path(os.environ["HF_HOME"]) / "hub"
    else:
        root = Path.home() / ".cache" / "huggingface" / "hub"

    if not root.is_dir():
        return []
    return sorted({folder.name.split("faster-whisper-")[-1]
                   for folder in root.glob("models--*faster-whisper-*")})


def onnx_models() -> list[dict]:
    """ONNX សម្រាប់ reframe — ឈ្មោះ, មានឬអត់, និងពាក្យបញ្ជាទាញបើខ្វះ."""
    wanted = [
        ("face detect", config.FACE_MODEL_PATH, config.FACE_MODEL_URL),
        ("face match", config.FACE_RECOGNITION_MODEL_PATH, config.FACE_RECOGNITION_MODEL_URL),
        ("subject", config.SUBJECT_MODEL_PATH, config.SUBJECT_MODEL_URL),
    ]
    items = []
    for label, path, url in wanted:
        path = Path(path)
        here = path.is_file()
        items.append({
            "label": label,
            "name": path.name,
            "present": here,
            "mb": round(path.stat().st_size / 1e6, 1) if here else 0,   # yunet = 0.2 MB
            "fix": "" if here else f"curl -L -o {path} {url}",
        })
    return items


def report(device: str, whisper_model: str, compute: str, out_dir: Path) -> dict:
    """ចម្លើយពេញរបស់ `GET /env` — UI គូរ chip និង pack ពីវា."""
    return {
        "device": device,
        "whisper_model": whisper_model,
        "compute_type": compute,
        "gpu": gpu(),
        "ram_mb": ram_mb(),
        "disk_free_mb": disk_free_mb(out_dir),
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ollama": ollama(),
        "whisper_cache": whisper_cache(),
        "onnx": onnx_models(),
        # llm.py ប្រើ API ពេលមាន key នេះ — យើងប្រាប់តែថា *មាន* មិនបង្ហាញ key
        "anthropic_key": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "anthropic_model": config.ANTHROPIC_MODEL,
    }
