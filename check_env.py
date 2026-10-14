"""Doctor script — run `python check_env.py` ដើម្បីដឹងថា environment រួចរាល់ឬអត់.

គ្មាន logic pipeline ទេ — គ្រាន់តែពិនិត្យ ហើយប្រាប់ថាត្រូវធ្វើអ្វីបើខ្វះ។
"""

import json
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import config

config.enable_utf8_output()  # ធានាថា terminal Windows បង្ហាញអក្សរខ្មែរបានដោយមិន crash

OK = "[ OK ]"
BAD = "[FAIL]"
WARN = "[WARN]"

results: list[bool] = []


def line(status: str, name: str, detail: str = "", fix: str = "") -> None:
    print(f"{status} {name:<22} {detail}")
    if fix:
        print(f"       -> {fix}")
    results.append(status != BAD)


def check_python() -> None:
    v = sys.version_info
    detail = f"{v.major}.{v.minor}.{v.micro}  ({sys.executable})"
    if (v.major, v.minor) >= (3, 11):
        line(OK, "Python", detail)
    else:
        line(BAD, "Python", detail, "ត្រូវការ Python 3.11+")


def check_venv() -> None:
    # sys.prefix != sys.base_prefix មានន័យថាយើងនៅក្នុង virtualenv
    in_venv = sys.prefix != sys.base_prefix
    if in_venv:
        line(OK, "virtualenv", sys.prefix)
    else:
        line(WARN, "virtualenv", "មិននៅក្នុង .venv", r"run: .venv\Scripts\activate")


def check_ffmpeg() -> None:
    for exe in ("ffmpeg", "ffprobe"):
        path = shutil.which(exe)
        if not path:
            line(BAD, exe, "រកមិនឃើញក្នុង PATH", "install FFmpeg រួចបន្ថែមទៅ PATH")
            continue
        out = subprocess.run([exe, "-version"], capture_output=True, text=True).stdout
        first = out.splitlines()[0] if out else "?"
        version = first.split(" ")[2] if len(first.split(" ")) > 2 else "?"
        if exe == "ffmpeg":
            has_ass = "--enable-libass" in out
            extra = "libass ✔" if has_ass else "libass ✘ (burn captions នឹងបរាជ័យ)"
            line(OK if has_ass else BAD, exe, f"{version}  {extra}")
        else:
            line(OK, exe, version)


def check_packages() -> None:
    wanted = ["faster_whisper", "ctranslate2", "typer", "rich", "pydantic", "ollama", "dotenv", "pytest"]
    missing = []
    for mod in wanted:
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        line(BAD, "python packages", f"ខ្វះ: {', '.join(missing)}", "pip install -r requirements.txt")
    else:
        line(OK, "python packages", f"{len(wanted)} modules import បាន")


def check_gpu() -> None:
    try:
        import ctranslate2
    except ImportError:
        line(BAD, "GPU (ctranslate2)", "ctranslate2 មិនទាន់ install")
        return

    try:
        count = ctranslate2.get_cuda_device_count()
    except Exception as e:
        line(WARN, "GPU (ctranslate2)", f"error: {e}", "នឹងប្រើ CPU")
        return

    if count == 0:
        line(WARN, "GPU (ctranslate2)", "គ្មាន CUDA device", "នឹងប្រើ CPU (យឺតជាង)")
        return

    types = sorted(ctranslate2.get_supported_compute_types("cuda"))
    line(OK, "GPU (ctranslate2)", f"{count} device, compute: {', '.join(types)}")


def check_cuda_dlls() -> None:
    """ពិនិត្យ DLL របស់ CUDA 12 (cublas/cudnn) ដែល CTranslate2 ត្រូវការលើ Windows."""
    folders = config.enable_cuda_dlls()
    if not folders:
        line(WARN, "CUDA DLLs", "គ្មាន nvidia-* packages",
             "pip install nvidia-cublas-cu12 nvidia-cudnn-cu12  (បើចង់ប្រើ GPU)")
        return

    # រាយឈ្មោះ DLL សំខាន់ដែលយើងត្រូវការពិត
    found = {}
    for folder in folders:
        for dll in folder.glob("*.dll"):
            if dll.name.startswith(("cublas64_", "cudnn64_", "cudnn_")):
                found[dll.name] = dll

    need_cublas = any(n.startswith("cublas64_12") for n in found)
    need_cudnn = any(n.startswith(("cudnn64_9", "cudnn_")) for n in found)
    detail = f"{len(folders)} folders, {len(found)} DLLs"
    if need_cublas and need_cudnn:
        line(OK, "CUDA DLLs", detail)
    else:
        missing = []
        if not need_cublas:
            missing.append("cublas64_12.dll")
        if not need_cudnn:
            missing.append("cudnn64_9.dll")
        line(WARN, "CUDA DLLs", f"{detail} — ខ្វះ {', '.join(missing)}", "នឹងប្រើ CPU ជំនួស")


def check_ollama() -> None:
    url = f"{config.OLLAMA_HOST}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, OSError, TimeoutError):
        line(BAD, "Ollama", f"ទាក់ទង {config.OLLAMA_HOST} មិនបាន",
             "winget install Ollama.Ollama  រួច  ollama serve")
        return

    names = [m["name"] for m in data.get("models", [])]
    wanted = config.OLLAMA_MODEL
    # Ollama ដាក់ ":latest" ពីក្រោយពេលខ្លះ
    has = any(n == wanted or n.startswith(wanted) for n in names)
    if has:
        line(OK, "Ollama", f"{wanted} រួចរាល់ ({len(names)} models)")
    else:
        line(BAD, "Ollama", f"server រត់ តែគ្មាន {wanted} ({', '.join(names) or 'គ្មាន model'})",
             f"ollama pull {wanted}")


def check_folders() -> None:
    root = Path(__file__).parent
    needed = ["pipeline", "prompts", "tests/fixtures", "output"]
    missing = [d for d in needed if not (root / d).is_dir()]
    if missing:
        line(BAD, "folders", f"ខ្វះ: {', '.join(missing)}")
    else:
        line(OK, "folders", ", ".join(needed))


def main() -> int:
    print("\n=== ClipForge Studio — environment check ===\n")
    check_python()
    check_venv()
    check_ffmpeg()
    check_packages()
    check_gpu()
    check_cuda_dlls()
    check_ollama()
    check_folders()

    try:
        device, model, compute = config.detect_device()
        print(f"\nWhisper នឹងប្រើ: device={device}  model={model}  compute_type={compute}")
    except Exception as e:
        print(f"\nconfig.py load មិនបាន: {e}")

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} ឆ្លងកាត់", "— រួចរាល់!" if failed == 0 else f"— {failed} ត្រូវកែ")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
