"""Default settings ទាំងអស់នៅទីនេះ — កុំ hardcode លេខក្នុង pipeline modules.

ចង់ប្តូរ clip length ឬ model? កែ file នេះតែមួយកន្លែង។
"""

import ctypes
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent
OUTPUT_DIR = PROJECT_ROOT / "output"
PROMPTS_DIR = PROJECT_ROOT / "prompts"

# ---------- Clips ----------
MAX_CLIPS = 5              # ចំនួន clip ចេញក្នុងមួយ video
MIN_CLIP_SEC = 15.0        # clip ខ្លីជាងនេះ = មិនយក
MAX_CLIP_SEC = 90.0        # clip វែងជាងនេះ = មិនយក
PADDING_SEC = 0.3          # បន្ថែមខាងដើម/ចុង ឲ្យកុំកាត់ពាក្យ

# ---------- LLM chunking ----------
CHUNK_SEC = 300.0          # ចែក transcript ជាផ្នែក ~5 នាទី
CHUNK_OVERLAP_SEC = 30.0   # ត្រួតគ្នា 30 វិនាទី ដើម្បីកុំកាត់ idea ពាក់កណ្តាល

# ---------- Whisper (faster-whisper) ----------
# GPU អ្នក = GTX 1060 3GB (Pascal): គ្មាន float16, VRAM តូច -> large-v3 មិនសម
WHISPER_MODEL_GPU = "medium"
WHISPER_COMPUTE_GPU = "int8_float32"
WHISPER_MODEL_CPU = "small"
WHISPER_COMPUTE_CPU = "int8"
WHISPER_LANGUAGE = None    # None = auto-detect

# ---------- LLM ----------
LLM_BACKEND = "ollama"                  # "ollama" (local) ឬ "anthropic" (API)
OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen2.5:7b-instruct"    # ប្តូរទៅ "qwen2.5:3b" ពេល dev ឲ្យលឿន
ANTHROPIC_MODEL = "claude-sonnet-5-5"   # ប្រើតែពេលមាន ANTHROPIC_API_KEY
LLM_TEMPERATURE = 0.2                   # ទាប = ចម្លើយជាប់លាប់ជាង (យើងចង់បាន JSON មិនមែនកំណាព្យ)
LLM_MAX_TOKENS = 2048                   # output tokens អតិបរមាក្នុងមួយ chunk
HIGHLIGHT_PROMPT = "podcast_highlights.md"   # file ក្នុង prompts/

# ---------- Render ----------
OUT_WIDTH = 1080
OUT_HEIGHT = 1920          # 9:16 vertical
VIDEO_CRF = 20             # លេខតូច = គុណភាពល្អ + file ធំ
VIDEO_PRESET = "medium"
AUDIO_BITRATE = "128k"

# ---------- Captions ----------
CAPTION_FONT = "Montserrat ExtraBold"
CAPTION_FONT_SIZE = 64
CAPTION_MAX_LINES = 2
CAPTION_MAX_CHARS_PER_LINE = 32
CAPTION_KEYWORD_COLOR = "#FFD23F"   # លឿង — keyword highlight

# ---------- Audio ----------
AUDIO_SAMPLE_RATE = 16000  # Whisper ចូលចិត្ត 16 kHz mono
AUDIO_CHANNELS = 1


def enable_utf8_output() -> None:
    """Windows terminal ច្រើនប្រើ codepage cp1252 ដែល encode អក្សរខ្មែរមិនបាន -> crash.

    reconfigure() ប្តូរ stdout/stderr ទៅ UTF-8. ហៅវានៅដើម entry point គ្រប់ file។
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


# រក្សា handle ពី os.add_dll_directory() និង DLL ដែល preload ទុកជារៀងរហូត។
# ឯកសារ Python: "The directory is removed when the object is closed or garbage collected."
_CUDA_DLL_HANDLES: list = []
_CUDA_FOLDERS: list = []


def enable_cuda_dlls() -> list[Path]:
    """Windows: ធ្វើឲ្យ CTranslate2 រក DLL របស់ CUDA 12 ឃើញ (ត្រឡប់បញ្ជី folder).

    បញ្ហាពិតដែលយើងបានជួប: CTranslate2 build ជាមួយ CUDA 12 (ត្រូវការ `cublas64_12.dll`)
    តែម៉ាស៊ីននេះមាន CUDA 13 (`cublas64_13.dll`) -> error "Library ... not found"។
    យើង install DLL តាម pip (`nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) ដែលចុះក្នុង
    `.venv/Lib/site-packages/nvidia/*/bin` — កន្លែងដែល Windows មិនមើលដោយស្វ័យប្រវត្តិ។

    ត្រូវធ្វើ ៣ យ៉ាង (តេស្តបានហើយថាទាំង ៣ ចាំបាច់)៖
      1. `os.add_dll_directory()` — សម្រាប់ DLL ដែល Python ខ្លួនឯង load
      2. បន្ថែម `PATH` — សម្រាប់ process ដែលមើល PATH
      3. **preload ដោយ path ពេញ** — ជំហានដែលធ្វើឲ្យវាដំណើរការពិត (មើល comment ខាងក្រោម)

    ត្រូវហៅ **មុន** `import faster_whisper` / ctranslate2 ប្រើ GPU។
    """
    if os.name != "nt":
        return []          # Linux/macOS រក .so តាមវិធីផ្សេង
    if _CUDA_DLL_HANDLES:
        return _CUDA_FOLDERS   # ធ្វើរួចហើយ -> កុំធ្វើម្តងទៀត
    try:
        import nvidia
    except ImportError:
        return []          # មិនទាន់ install -> ធ្លាក់ទៅ CPU តាមធម្មតា

    added: list[Path] = []
    for root in getattr(nvidia, "__path__", []):
        # រាល់ package nvidia-* ដាក់ DLL ក្នុង <name>/bin — ស្កេនទាំងអស់
        # (cublas, cudnn, cuda_nvrtc, ...) ដើម្បីកុំខកកន្លែងណាមួយ
        for folder in sorted(Path(root).glob("*/bin")):
            if folder.is_dir():
                _CUDA_DLL_HANDLES.append(os.add_dll_directory(str(folder)))
                added.append(folder)

    if added:
        current = os.environ.get("PATH", "")
        prefix = os.pathsep.join(str(f) for f in added)
        if prefix not in current:
            os.environ["PATH"] = prefix + os.pathsep + current

    # ជំហានដែលធ្វើឲ្យវាដំណើរការពិត: preload DLL ដោយ path ពេញ។
    # មូលហេតុ: CTranslate2 ជាកូដ C++ ហៅ LoadLibraryA("cublas64_12.dll") តាមឈ្មោះសុទ្ធ
    # ហើយវាមិនឃើញ folder របស់យើង។ ប៉ុន្តែពេល DLL នោះស្ថិតក្នុង process រួចហើយ
    # Windows ប្រគល់ module ដែល load ស្រាប់នោះវិញតាមឈ្មោះ -> CT2 រកឃើញ។
    # លំដាប់សំខាន់: cublasLt ត្រូវមុន cublas (cublas ពឹងលើវា)។
    for folder in added:
        for name in ("cublasLt64_12.dll", "cublas64_12.dll", "cudnn64_9.dll"):
            dll = folder / name
            if dll.is_file():
                try:
                    _CUDA_DLL_HANDLES.append(ctypes.WinDLL(str(dll)))
                except OSError:
                    pass   # load មិនបាន -> ធ្លាក់ទៅ CPU តាមធម្មតា

    _CUDA_FOLDERS.extend(added)
    return added


def detect_device() -> tuple[str, str, str]:
    """ពិនិត្យថាមាន GPU ឬអត់ រួចត្រឡប់ (device, model, compute_type).

    tuple = បញ្ជីតម្លៃច្រើនផ្ញើមកវិញម្តង។ ឧទាហរណ៍:
        device, model, compute = detect_device()
    """
    try:
        import ctranslate2
    except ImportError:
        return ("cpu", WHISPER_MODEL_CPU, WHISPER_COMPUTE_CPU)

    try:
        if ctranslate2.get_cuda_device_count() > 0:
            supported = ctranslate2.get_supported_compute_types("cuda")
            # បើ GPU មិន support int8_float32 ធ្លាក់ទៅ float32
            compute = WHISPER_COMPUTE_GPU if WHISPER_COMPUTE_GPU in supported else "float32"
            return ("cuda", WHISPER_MODEL_GPU, compute)
    except Exception:
        # GPU មានបញ្ហា (driver/cuDNN) -> ប្រើ CPU ជាជាង crash
        pass

    return ("cpu", WHISPER_MODEL_CPU, WHISPER_COMPUTE_CPU)
