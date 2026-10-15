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
RANK_PROMPT = "rank_clips.md"
# ជំហានទី ២: សុំ model ដាក់លំដាប់ candidate ធៀបគ្នា ព្រោះពិន្ទុដាច់ដោយឡែករបស់វា
# ជាប់គាំងនៅ 9 (វាស់ឃើញ: 9,9,9,9,9)។ ថ្លៃបន្ថែម ~១ នាទីក្នុងមួយ video។
RANK_CANDIDATES = True
MAX_RANK_CANDIDATES = 15     # candidate ច្រើនពេកធ្វើឲ្យ prompt វែង និងយឺត

# ---------- Render ----------
OUT_WIDTH = 1080
OUT_HEIGHT = 1920          # 9:16 vertical (default)

# ទំហំស្តង់ដារក្នុងមួយ aspect ratio។ ទទឹង 1080 សម្រាប់ portrait/square ព្រោះវាជា
# ទំហំដែល TikTok/Reels/Shorts ប្រើ; 16:9 ប្រើ 1920×1080 សម្រាប់ YouTube ធម្មតា។
ASPECT_PRESETS = {
    "9:16": (1080, 1920),      # TikTok, Reels, Shorts
    "4:5": (1080, 1350),       # Instagram feed (កាន់កាប់ផ្ទៃច្រើនជាង 1:1)
    "1:1": (1080, 1080),       # square feed
    "16:9": (1920, 1080),      # YouTube, LinkedIn
}
# ទិសដៅដាក់ផ្ទាំងក្នុង split: portrait/square -> ជាន់គ្នាបញ្ឈរ; landscape -> ឆ្វេង/ស្តាំ
SPLIT_DIRECTION = "vertical"
VIDEO_CRF = 20             # លេខតូច = គុណភាពល្អ + file ធំ
VIDEO_PRESET = "medium"
AUDIO_BITRATE = "128k"

# ---------- Reframe (split screen / face crop) ----------
# ពេល camera កាត់ប្តូរ រូបប្រែខ្លាំង -> scene score ខ្ពស់។ 0.3 ជាតម្លៃដែលវាស់ឃើញថាល្អ
# លើ podcast ដែលមាន multi-camera (ចាប់ការកាត់ ២២ ដងក្នុង ១២០ វិនាទី)។
SCENE_THRESHOLD = 0.3
# shot ខ្លីជាងនេះ បញ្ចូលទៅ shot មុន។ **កុំដំឡើងលេខនេះ** — យើងធ្លាប់ដាក់ 2.0 ហើយ
# shot close-up 1.4s ត្រូវបានបញ្ចូលទៅ shot wide មុន។ ប្រអប់កៅអី (x=412, x=1381)
# ត្រូវបានដាក់លើ frame close-up ហើយផ្ទាំង split បង្ហាញតែជញ្ជាំង គ្មានមនុស្ស។
# ការបញ្ចូលត្រូវកើតតែពេល layout ដូចគ្នា (មើល `smooth_segments`) មិនមែនតាមពេលទេ។
MIN_SHOT_SEC = 1.0
# split ដែលខ្លីជាងនេះមិនសមនឹងការប្តូរ layout ទេ -> បង្ហាញជា single វិញ។
# ការលោតពី close-up ទៅ split ៣ វិនាទី រួចត្រឡប់វិញ មើលទៅដូចកំហុស។
MIN_SPLIT_SEC = 4.0

FACE_MODEL_PATH = PROJECT_ROOT / "models" / "face_detection_yunet_2023mar.onnx"
FACE_MODEL_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                  "face_detection_yunet/face_detection_yunet_2023mar.onnx")
# SFace: ប្រាប់ថា "មុខក្នុង close-up នេះជាអ្នកណា" ដោយប្រៀបធៀបនឹងមុខក្នុងកៅអី។
# វាស់លើ footage ពិត: ត្រូវគ្នា 0.66-0.72, មិនត្រូវគ្នា 0.11-0.16 -> គម្លាតធំ ជឿទុកចិត្តបាន។
FACE_RECOGNITION_MODEL_PATH = PROJECT_ROOT / "models" / "face_recognition_sface_2021dec.onnx"
FACE_RECOGNITION_MODEL_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
                              "face_recognition_sface/face_recognition_sface_2021dec.onnx")
FACE_MATCH_THRESHOLD = 0.30         # cosine អប្បបរមាទើបរាប់ថាជាមនុស្សតែម្នាក់
# វាស់លើ footage ពិត: មុខពិត 0.90-0.94, false positive (ចង្កៀង) 0.53-0.57
FACE_MIN_SCORE = 0.70
MIN_FACE_SEPARATION = 0.15          # មុខ ២ ត្រូវឃ្លាតគ្នា >15% នៃទទឹង ទើបរាប់ជា two-shot

SEAT_SAMPLE_FRAMES = 60             # frame ដែលស្កេនទាំង video ដើម្បីរកកៅអី
MIN_SEAT_SAMPLES = 5                # ត្រូវឃើញ two-shot យ៉ាងតិចប៉ុណ្ណេះ ទើបទុកចិត្ត
SHOT_SAMPLE_FRAMES = 3              # frame គំរូក្នុងមួយ shot

PANEL_ASPECT = 1080 / 960           # ផ្ទាំងនីមួយៗក្នុង split = 9:8
# កម្ពស់ប្រអប់ = កម្ពស់មុខ × នេះ។ តូច = ជិតជាង តែពង្រីកខ្លាំងជាង (ព្រិល)។
# មុខក្នុង wide shot ទទឹង ~100px ដូច្នេះ: 4.5 -> ពង្រីក 1.3x (ច្បាស់ តែឆ្ងាយ),
# 3.0 -> 1.9x, 2.0 -> 2.9x (ជិតដូច OpusClip តែព្រិល)។
PANEL_ZOOM = 2.0
SPLIT_TOP = "auto"                  # "auto" (អ្នកនិយាយលើ), "left", ឬ "right"

# ---------- Captions ----------
CAPTION_FONT = "Montserrat ExtraBold"
# បើ font ខាងលើគ្មានលើម៉ាស៊ីន -> សាកតាមលំដាប់នេះ (captions.resolve_font ព្រមានឲ្យដឹង)
CAPTION_FONT_FALLBACKS = ("Inter Bold", "Arial Black", "Arial")
# Style ខ្លីៗបែប short-form (តាម OpusClip): អក្សរធំ, ពាក្យតិចក្នុងមួយបន្ទាត់, ALL CAPS។
# វាស់ពិតដោយ FFmpeg+libass (render frame រួចរាប់ pixel), Montserrat ExtraBold,
# 16 តួ ALL CAPS: 72px -> 497px | 90px -> 621px | 110px -> 759px | 130px -> 896px
# ទំនេរ = 1080 - 2×60 margin = 960px ដូច្នេះ 110px គ្របដណ្តប់ ~70% នៃទទឹង។
CAPTION_FONT_SIZE = 110
CAPTION_MAX_LINES = 3
CAPTION_MAX_CHARS_PER_LINE = 16
# ពាក្យច្រើនក្នុង cue តែមួយធ្វើឲ្យអ្នកមើលអានមិនទាន់។ OpusClip បង្ហាញ ~៤ ពាក្យខ្លី។
CAPTION_MAX_WORDS_PER_CUE = 4
# ALL CAPS ជា style ស្តង់ដារនៃ short-form — អានបានលឿនពេលរំកិលមើល
CAPTION_UPPERCASE = True
CAPTION_KEYWORD_COLOR = "#FFD23F"   # លឿង — keyword highlight (OpusClip ប្រើបៃតង #00E054)
# cue ឥឡូវខ្លី (16 តួ × 3 បន្ទាត់) ដូច្នេះ ១ ពាក្យក្នុងមួយ cue គ្រប់គ្រាន់។
# ២ ពាក្យធ្វើឲ្យពាក់កណ្តាល cue ក្លាយជាលឿង ហើយការបំលេចអស់អត្ថន័យ។
CAPTION_KEYWORDS_PER_CUE = 1
# cue ត្រូវបិទត្រង់ចុងប្រយោគ តែលុះត្រាតែវាមានអក្សរយ៉ាងតិចប៉ុណ្ណេះ — បើមិនដូច្នោះ
# ប្រយោគខ្លី ("Yeah.") ក្លាយជា cue ភ្លឹបភ្លែតដាច់ដោយឡែក។
CAPTION_MIN_CUE_CHARS = 12
# បំលេចពាក្យដែលកំពុងនិយាយ (លឿង + ធំបន្តិច) ជំនួស keyword ថេរ។
# False = ត្រឡប់ទៅ keyword ថេរ (ងាយប្រៀបធៀប)។
CAPTION_WORD_HIGHLIGHT = True
# ពាក្យសកម្មពង្រីក **បញ្ឈរតែប៉ុណ្ណោះ** (\fscy)។ ការពង្រីកទាំងទទឹង (\fs) ប្តូរទទឹង
# បន្ទាត់ ហើយដោយបន្ទាត់ដាក់កណ្តាល ពាក្យឯទៀតលោតឆ្វេង-ស្តាំរាល់ពេលបំលេចផ្លាស់ទី។
# វាស់រួច: \fs -> ទទឹង 692->708/712px (លោត); \fscy -> 692px ដដែល, កម្ពស់ 51->55px។
# 1.0 = បំលេចតែពណ៌ គ្មានការពង្រីក។
CAPTION_ACTIVE_SCALE = 1.10
CAPTION_MIN_WORD_SEC = 0.10         # ពាក្យខ្លីពេកធ្វើឲ្យការបំលេចភ្លឹបភ្លែត
CAPTION_TEXT_COLOR = "#FFFFFF"      # ពណ៌អត្ថបទធម្មតា
CAPTION_OUTLINE_COLOR = "#000000"   # គ្រោងខ្មៅ ឲ្យអានបានលើផ្ទាំងពណ៌ណាក៏បាន
CAPTION_OUTLINE = 4                 # ប្រវែងគ្រោង (px)
CAPTION_SHADOW = 1
CAPTION_MARGIN_X = 60               # ចន្លោះឆ្វេង/ស្តាំ
CAPTION_MARGIN_V = 420              # កម្ពស់ពីបាត (1920) -> caption នៅ lower third
# ក្នុង split screen ស្នាមរវាងផ្ទាំងពីរនៅ y=960។ OpusClip ដាក់អក្សរ **ឆ្លងកាត់** ស្នាម។
# ប្លុក ៣ បន្ទាត់នៅ 110px ខ្ពស់ ~363px ដូច្នេះ 780 ដាក់កណ្តាលប្លុកត្រង់ស្នាមគត់។
CAPTION_MARGIN_V_SPLIT = 780
CAPTION_LINE_GAP = 90               # គម្លាតបន្ទាត់ (គណនាឡើងវិញក្នុង apply_aspect)

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


def apply_aspect(name: str) -> tuple[int, int]:
    """កំណត់ទំហំ output តាម aspect ratio ហើយគណនាតម្លៃដែលពឹងលើវាឡើងវិញ.

    តម្លៃជាច្រើន (ទំហំ font, margin, សមាមាត្រផ្ទាំង) ត្រូវតែផ្លាស់ប្តូរតាមទំហំ output។
    បើយើងទុកវាថេរ នោះ caption នឹងតូចពេកលើ 16:9 ហើយផ្ទាំង split នឹងខុសសមាមាត្រ។
    Function នេះគណនាទាំងអស់ពី preset តែមួយ។

    ហៅវា **ម្តងនៅដើម** មុនពេលផ្នែកណាមួយអាន config។
    """
    global OUT_WIDTH, OUT_HEIGHT, PANEL_ASPECT, SPLIT_DIRECTION
    global CAPTION_FONT_SIZE, CAPTION_MARGIN_X, CAPTION_MARGIN_V, CAPTION_MARGIN_V_SPLIT
    global CAPTION_LINE_GAP

    if name not in ASPECT_PRESETS:
        raise ValueError(f"aspect មិនស្គាល់: {name} (មាន {', '.join(ASPECT_PRESETS)})")

    OUT_WIDTH, OUT_HEIGHT = ASPECT_PRESETS[name]
    SPLIT_DIRECTION = "vertical" if OUT_HEIGHT >= OUT_WIDTH else "horizontal"

    # ផ្ទាំងនីមួយៗយកពាក់កណ្តាលនៃទិសដែលយើងបែងចែក
    if SPLIT_DIRECTION == "vertical":
        PANEL_ASPECT = OUT_WIDTH / (OUT_HEIGHT / 2)
    else:
        PANEL_ASPECT = (OUT_WIDTH / 2) / OUT_HEIGHT

    # caption ធ្លាប់វាស់នៅទទឹង 1080 -> ធ្វើមាត្រដ្ឋានតាមទទឹងថ្មី
    scale = OUT_WIDTH / 1080
    CAPTION_MARGIN_X = int(60 * scale)

    # ...តែកុំឲ្យប្លុកអក្សរលេបរូប។ នៅ 16:9 ការធ្វើមាត្រដ្ឋានតាមទទឹងផ្តល់ font 195px
    # ហើយ ៣ បន្ទាត់ត្រូវការ 54% នៃកម្ពស់ — ធំពេក។ ដាក់ដែនត្រឹម 30% នៃកម្ពស់។
    height_cap = OUT_HEIGHT * 0.30 / (CAPTION_MAX_LINES * 1.1)
    CAPTION_FONT_SIZE = int(min(110 * scale, height_cap))

    # libass **មិនអើពើ** `LineSpacing` ក្នុង [Script Info] (វាស់រួច: 0/30/60 ផ្តល់លទ្ធផល
    # ដូចគ្នាបេះបិទ)។ យើងដាក់បន្ទាត់នីមួយៗដោយ `\pos` វិញ ដូច្នេះគម្លាតនេះត្រូវប្រើពិត។
    # 0.82 ផ្តល់ ~90px នៅ font 110 — តឹងជាង default របស់ libass (~110px)។
    CAPTION_LINE_GAP = int(CAPTION_FONT_SIZE * 0.82)
    CAPTION_MARGIN_V = int(OUT_HEIGHT * 0.22)      # ~lower third, ផុតពី UI របស់ platform

    if SPLIT_DIRECTION == "vertical":
        # ដាក់ប្លុកអក្សរឲ្យកណ្តាលត្រង់ស្នាម (y = កម្ពស់/2) ដូច OpusClip
        block_height = CAPTION_MAX_LINES * CAPTION_FONT_SIZE * 1.1
        CAPTION_MARGIN_V_SPLIT = max(0, int(OUT_HEIGHT / 2 - block_height / 2))
    else:
        CAPTION_MARGIN_V_SPLIT = CAPTION_MARGIN_V   # គ្មានស្នាមផ្ដេកទេ

    return OUT_WIDTH, OUT_HEIGHT
