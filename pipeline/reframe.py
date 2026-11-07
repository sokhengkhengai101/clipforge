"""រកមើលថា shot នីមួយៗគួរ reframe បែបណា — split screen, crop តាមមុខ, ឬ center.

**បញ្ហាដែល module នេះដោះស្រាយ**: `render.py` ធ្វើ center-crop ឋិតថេរ។ លើ podcast ពិត
មនុស្សអង្គុយឆ្វេង និងស្តាំ ដូច្នេះ center-crop កាត់មុខទាំងពីរចេញ។

**អ្វីដែលយើងរកឃើញក្នុង footage ពិត** (The-Future-Mark-Zuckerberg.mp4)៖
  - camera កាត់ប្តូរ **មធ្យមរាល់ 4.6 វិនាទី** -> clip 30s មាន ~6-7 shot
  - មាន shot ២ ប្រភេទ: wide (មនុស្ស ២ នាក់ profile) និង close-up (ម្នាក់)
ដូច្នេះ layout ត្រូវសម្រេច **ក្នុងមួយ shot** មិនមែនក្នុងមួយ clip។

Face detector គឺ **YuNet** (ONNX តូច 228KB) ដែលចាប់មុខទ្រេត (profile) បាន score 0.90+
លើ footage នេះ។ ការសាកល្បងបង្ហាញថា false positive (ចង្កៀង) បាន score 0.53-0.57
ដូច្នេះយើងច្រោះត្រឹម 0.70។
"""

import json
import math
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path

import config
from pipeline.audio import require_ffmpeg
from pipeline.highlights import Clip


class ReframeError(RuntimeError):
    """រក face detector ឬ frame មិនបាន."""


# ---------- រចនាសម្ព័ន្ធ data ----------

@dataclass
class Face:
    """មុខមួយដែលចាប់បាន (pixel ក្នុងរូបដើម).

    `landmarks` = ចំណុច ៥ (ភ្នែក ២, ច្រមុះ, មាត់ ២) ជាលេខ ១០។ SFace ត្រូវការវា
    ដើម្បីតម្រង់មុខឲ្យត្រង់មុននឹងគណនា embedding។
    """

    x: int
    y: int
    w: int
    h: int
    score: float
    landmarks: list[float] = field(default_factory=list)

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


@dataclass
class Seats:
    """កៅអីពីរក្នុង wide shot + "ស្នាមម្រាមដៃ" នៃមុខនីមួយៗ (embedding).

    embedding ជាបញ្ជីលេខដែលតំណាងឲ្យមុខមួយ។ មុខដូចគ្នា -> លេខជិតគ្នា។ យើងប្រើវា
    ដើម្បីដឹងថា close-up មួយជាអ្នកណា ព្រោះ close-up មិនរក្សាទីតាំងអង្គុយទេ។
    """

    left: Face
    right: Face
    left_embedding: list[float] = field(default_factory=list)
    right_embedding: list[float] = field(default_factory=list)

    def as_tuple(self) -> tuple[Face, Face]:
        return self.left, self.right


@dataclass
class Box:
    """ប្រអប់ crop (pixel ក្នុងរូបដើម). លេខគូទាំងអស់ ព្រោះ H.264 តម្រូវ.

    `x_expr` ជា expression របស់ FFmpeg ដែលគណនា x តាមពេល (`t`)។ យើងប្រើវាពេល
    មុខផ្លាស់ទីក្នុង shot — ប្រអប់ថេរធ្វើឲ្យមុខចេញក្រៅរូប។ `x` នៅតែត្រូវកំណត់
    ជាតម្លៃមធ្យម ដើម្បីឲ្យកូដផ្សេង (ការគណនាការពង្រីក) នៅដំណើរការ។
    """

    x: int
    y: int
    w: int
    h: int
    x_expr: str | None = None

    def as_filter(self) -> str:
        if self.x_expr:
            return f"crop={self.w}:{self.h}:x='{self.x_expr}':y={self.y}"
        return f"crop={self.w}:{self.h}:{self.x}:{self.y}"


@dataclass
class Layout:
    """របៀបដែល shot មួយត្រូវបម្លែងទៅទម្រង់បញ្ឈរ.

    `panels` ជាបញ្ជី (ពី ២ ដល់ ៤ ផ្ទាំង) តាមលំដាប់បង្ហាញ។ `top`/`bottom` នៅរក្សា
    ទុកជាឈ្មោះងាយស្រួលសម្រាប់ករណី split ដែលមានតែ ២ ផ្ទាំង។
    """

    kind: str                      # "split" | "three" | "four" | "screen1" | "screen2" | "single" | "fit" | "center"
    panels: list[Box] = field(default_factory=list)
    box: Box | None = None         # single / center (និងប្រអប់បម្រុងរបស់ split); custom = crop
    place: tuple[int, int, int, int] | None = None   # custom: ទទឹង, កម្ពស់, x, y លើ output
    person: str | None = None      # single: "left" / "right" / None (អ្នកណាក្នុង close-up)

    @property
    def top(self) -> Box | None:
        return self.panels[0] if self.panels else None

    @property
    def bottom(self) -> Box | None:
        return self.panels[1] if len(self.panels) > 1 else None


@dataclass
class Segment:
    """ចន្លោះពេលមួយក្នុង clip ដែលមាន layout តែមួយ (ពេលធៀបនឹង video ដើម)."""

    start: float
    end: float
    layout: Layout

    @property
    def duration(self) -> float:
        return self.end - self.start


# ---------- ការកាត់ camera (scene cuts) ----------

def detect_cuts(video_path: Path, start: float, end: float,
                threshold: float | None = None) -> list[float]:
    """ត្រឡប់ពេលវេលា (វិនាទី, ធៀបនឹង video ដើម) ដែល camera កាត់ប្តូរ.

    FFmpeg filter `select='gt(scene,T)'` ប្រៀបធៀប frame នីមួយៗនឹង frame មុន ហើយឲ្យ
    ពិន្ទុ 0..1។ ពិន្ទុខ្ពស់ = រូបប្តូរខ្លាំង = ទំនងជាការកាត់។
    """
    threshold = config.SCENE_THRESHOLD if threshold is None else threshold
    require_ffmpeg("ffmpeg")

    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostdin",
         "-ss", f"{start:.3f}", "-t", f"{max(0.0, end - start):.3f}",
         "-i", str(video_path),
         "-filter_complex", f"select='gt(scene,{threshold})',metadata=print:file=-",
         "-an", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )

    cuts: list[float] = []
    for line in result.stdout.splitlines():
        if "pts_time:" not in line:
            continue
        try:
            # `-ss` មុន `-i` ធ្វើឲ្យពេលវេលាចាប់ពី 0 -> បូក start វិញ
            cuts.append(start + float(line.split("pts_time:")[1].split()[0]))
        except (IndexError, ValueError):
            continue
    return cuts


def split_into_shots(start: float, end: float, cuts: list[float],
                     min_shot_sec: float | None = None) -> list[tuple[float, float]]:
    """បម្លែងបញ្ជីការកាត់ទៅចន្លោះពេល (shot).

    Shot ខ្លីជាង `min_shot_sec` ត្រូវបញ្ចូលទៅ shot មុន — ព្រោះ scene detection
    ចាប់ចលនាលឿនជាការកាត់ខុសៗ ហើយ shot 0.3s មិនមានតម្លៃ reframe ដោយឡែកទេ។
    """
    min_shot_sec = config.MIN_SHOT_SEC if min_shot_sec is None else min_shot_sec

    points = [start] + [c for c in sorted(cuts) if start < c < end] + [end]
    shots: list[tuple[float, float]] = []
    for a, b in zip(points, points[1:]):
        if b - a < min_shot_sec and shots:
            shots[-1] = (shots[-1][0], b)      # បញ្ចូលទៅ shot មុន
        else:
            shots.append((a, b))

    # shot **ដំបូង** គ្មាន shot មុនឲ្យបញ្ចូលទេ ដូច្នេះបើវាខ្លីពេក បញ្ចូលវាទៅ shot បន្ទាប់។
    # បើមិនដូច្នោះ clip ចាប់ផ្តើមដោយការភ្លឹបភ្លែត ១ វិនាទី (យើងឃើញពិតក្នុង clip #3)។
    if len(shots) > 1 and shots[0][1] - shots[0][0] < min_shot_sec:
        shots[1] = (shots[0][0], shots[1][1])
        shots.pop(0)

    return shots or [(start, end)]


# ---------- ការចាប់មុខ ----------

# detector មួយ **ក្នុងមួយ thread** — YuNet object មិនមែន thread-safe ហើយយើង
# វិភាគ shot ស្របគ្នាដើម្បីបង្កើនល្បឿន។
_thread_state = threading.local()


def _get_detector(width: int, height: int):
    """ផ្ទុក YuNet ម្តងក្នុងមួយ thread រួចប្រើឡើងវិញ (ការផ្ទុកយឺត ~0.3s)."""
    cache = getattr(_thread_state, "detectors", None)
    if cache is None:
        cache = _thread_state.detectors = {}
    key = (width, height)
    if key in cache:
        return cache[key]

    try:
        import cv2
    except ImportError as e:
        raise ReframeError("ត្រូវការ opencv: pip install opencv-python-headless") from e

    model = Path(config.FACE_MODEL_PATH)
    if not model.is_file():
        raise ReframeError(
            f"គ្មាន face model នៅ {model}។ Download:\n"
            f"  curl -L -o {model} {config.FACE_MODEL_URL}"
        )

    detector = cv2.FaceDetectorYN_create(
        str(model), "", (width, height), config.FACE_MIN_SCORE, 0.3, 5000
    )
    cache[key] = detector
    return detector


def _get_recognizer():
    """ផ្ទុក SFace ម្តងក្នុងមួយ thread — model ដែលបម្លែងមុខទៅជាលេខ (embedding)."""
    existing = getattr(_thread_state, "recognizer", None)
    if existing is not None:
        return existing

    import cv2

    model = Path(config.FACE_RECOGNITION_MODEL_PATH)
    if not model.is_file():
        raise ReframeError(
            f"គ្មាន face recognition model នៅ {model}។ Download: "
            f"curl -L -o {model} {config.FACE_RECOGNITION_MODEL_URL}"
        )
    recognizer = cv2.FaceRecognizerSF_create(str(model), "")
    _thread_state.recognizer = recognizer
    return recognizer


def face_embedding(frame, face: Face) -> list[float]:
    """បម្លែងមុខមួយទៅជាបញ្ជីលេខ ១២៨។ មុខដូចគ្នា -> លេខជិតគ្នា."""
    import numpy as np

    if not face.landmarks:
        return []
    recognizer = _get_recognizer()
    row = np.array([[face.x, face.y, face.w, face.h, *face.landmarks, face.score]],
                   dtype=np.float32)
    aligned = recognizer.alignCrop(frame, row[0])
    return [float(v) for v in recognizer.feature(aligned).flatten()]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """ប្រៀបធៀប embedding ២។ 1.0 = ដូចបេះបិទ, 0 = គ្មានទំនាក់ទំនង."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


def grab_frame(video_path: Path, timestamp: float, size: tuple[int, int]):
    """ទាញ frame ១ នៅវិនាទីនោះមកជា numpy array (BGR).

    យើងអាន raw bytes ចេញពី FFmpeg ដោយផ្ទាល់ (pipe) ជាជាងសរសេរ PNG ចូល disk —
    លឿនជាង ហើយមិនទុកសំរាម។
    """
    import numpy as np

    width, height = size
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
         "-ss", f"{timestamp:.3f}", "-i", str(video_path), "-frames:v", "1",
         "-pix_fmt", "bgr24", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    expected = width * height * 3
    if len(result.stdout) < expected:
        return None            # ហួសចុង video ឬ decode មិនបាន
    return np.frombuffer(result.stdout[:expected], dtype=np.uint8).reshape(height, width, 3).copy()


def detect_faces_in_frame(frame, size: tuple[int, int]) -> list[Face]:
    """រាយមុខទាំងអស់ក្នុង frame មួយ (តម្រៀបពីឆ្វេងទៅស្តាំ)."""
    if frame is None:
        return []
    width, height = size
    detector = _get_detector(width, height)
    detector.setInputSize((width, height))
    ok, raw = detector.detect(frame)
    if raw is None:
        return []

    faces = []
    for row in raw:
        x, y, w, h = (int(v) for v in row[:4])
        score = float(row[-1])
        if score < config.FACE_MIN_SCORE:
            continue
        # ច្រោះប្រអប់ធំសម្បើម: false positive (ឧ. ចង្កៀង) ទទឹងលើស 45% នៃរូប
        if w > width * 0.45:
            continue
        # ច្រោះប្រអប់តូចពេក: រូបថតលើជញ្ជាំង ឬមនុស្សឆ្ងាយ — មិនអាចជាអ្នកនិយាយទេ
        if h < height * config.FACE_MIN_HEIGHT_RATIO:
            continue
        faces.append(Face(x=x, y=y, w=w, h=h, score=round(score, 3),
                          landmarks=[float(v) for v in row[4:14]]))
    return sorted(faces, key=lambda f: f.cx)


def detect_faces(video_path: Path, timestamp: float, size: tuple[int, int]) -> list[Face]:
    return detect_faces_in_frame(grab_frame(video_path, timestamp, size), size)


# ---------- ប្រអប់ crop ----------

def _even_size(value: float) -> int:
    """ទំហំត្រូវជាលេខគូ និងយ៉ាងតិច 2 px (H.264 yuv420p តម្រូវ)."""
    return max(2, int(value) // 2 * 2)


def _even_pos(value: float) -> int:
    """ទីតាំងត្រូវជាលេខគូ តែ **អាចជា 0** — កុំច្រឡំនឹងទំហំ."""
    return max(0, int(value) // 2 * 2)


def _clamp_box(x: float, y: float, w: float, h: float,
               frame_w: int, frame_h: int) -> Box:
    """ធ្វើឲ្យប្រអប់នៅក្នុងរូប, លេខគូ, និងមិនធំជាងរូប."""
    w = _even_size(min(w, frame_w))
    h = _even_size(min(h, frame_h))
    x = _even_pos(min(max(0, x), frame_w - w))
    y = _even_pos(min(max(0, y), frame_h - h))
    return Box(x=x, y=y, w=w, h=h)


PANEL_GRIDS = {"split": 2, "three": 3, "four": 4}
# screen1 = slide + មនុស្ស ១, screen2 = slide + មនុស្ស ២ (layout `screen`)
SCREEN_KINDS = {"screen1": 2, "screen2": 3}
PANEL_GRIDS.update(SCREEN_KINDS)


def _even(value: float) -> int:
    return max(2, int(value) // 2 * 2)


def panel_rects(kind: str) -> list[tuple[int, int, int, int]]:
    """(x, y, w, h) នៃផ្ទាំងនីមួយៗក្នុងរូបលទ្ធផល.

    - `split`: ពីរស្មើគ្នា (បញ្ឈរលើ output បញ្ឈរ, ផ្ដេកលើ 16:9)
    - `three`: **ផ្ទាំងធំ ១ + តូច ២** ដូច OpusClip — អ្នកនិយាយមេបានទំហំ ២/៣
      ហើយពីរនាក់ទៀតចែកជួរក្រោម។ ៣ ជួរស្មើគ្នាធ្វើឲ្យគ្មាននរណាលេចធ្លោ។
    - `four`: ក្រឡា 2×2 (៤ ជួរដេកនឹងឲ្យផ្ទាំង 1080×480 ដែលរាក់ពេក)
    """
    out_w, out_h = config.OUT_WIDTH, config.OUT_HEIGHT
    horizontal = config.SPLIT_DIRECTION == "horizontal"

    if kind == "split":
        if horizontal:
            half = _even(out_w / 2)
            return [(0, 0, half, out_h), (half, 0, out_w - half, out_h)]
        half = _even(out_h / 2)
        return [(0, 0, out_w, half), (0, half, out_w, out_h - half)]

    if kind == "three":
        if horizontal:
            big = _even(out_w * 2 / 3)
            side, half = out_w - big, _even(out_h / 2)
            return [(0, 0, big, out_h), (big, 0, side, half),
                    (big, half, side, out_h - half)]
        big = _even(out_h * 2 / 3)
        bottom, half = out_h - big, _even(out_w / 2)
        return [(0, 0, out_w, big), (0, big, half, bottom),
                (half, big, out_w - half, bottom)]

    if kind in SCREEN_KINDS:
        # slide ខាងលើពេញទទឹង; មនុស្សខាងក្រោម (ម្នាក់ពេញទទឹង ឬពីរនាក់ចំហៀងគ្នា).
        # តែ output បញ្ឈរ/ការ៉េ — លើ 16:9 ផ្ទាំង slide ខាងលើនឹងរាក់ពេក
        if horizontal:
            return []
        top = _even(out_h * config.SCREEN_TOP_RATIO)
        bottom = out_h - top
        if kind == "screen1":
            return [(0, 0, out_w, top), (0, top, out_w, bottom)]
        half = _even(out_w / 2)
        return [(0, 0, out_w, top), (0, top, half, bottom),
                (half, top, out_w - half, bottom)]

    if kind == "four":
        half_w, half_h = _even(out_w / 2), _even(out_h / 2)
        return [(0, 0, half_w, half_h), (half_w, 0, out_w - half_w, half_h),
                (0, half_h, half_w, out_h - half_h),
                (half_w, half_h, out_w - half_w, out_h - half_h)]
    return []


def panel_box(face: Face, frame_w: int, frame_h: int,
              aspect: float | None = None, zoom: float | None = None,
              kind: str | None = None, index: int = 0) -> Box:
    """ប្រអប់សម្រាប់ផ្ទាំងមួយក្នុង split (សមាមាត្រ 9:8 = 1.125).

    កម្ពស់ = កម្ពស់មុខ × `zoom` ដូច្នេះមុខមិនពេញអេក្រង់ពេក ហើយនៅមានបរិបទ។
    មុខត្រូវដាក់នៅ ~40% ពីលើ ដែលជាទម្រង់ធម្មតានៃ portrait។
    """
    if aspect is None:
        rects = panel_rects(kind) if kind else []
        if rects:
            panel_w, panel_h = panel_inner(rects[min(index, len(rects) - 1)])
            aspect = panel_w / panel_h
        else:
            aspect = config.PANEL_ASPECT
    zoom = config.PANEL_ZOOM if zoom is None else zoom

    height = min(frame_h, face.h * zoom)
    width = height * aspect

    # ប្រអប់ធំជាងទីធ្លាសងខាងមុខ -> `_clamp_box` រុញវាចូល ហើយមុខទៅជាប់គែមផ្ទាំង
    # (យើងឃើញពិត: មុខនៅ x=1100 ក្នុងរូប 1280 ទទឹង, ប្រអប់ 606 -> មុខនៅ 70%)។
    room = min(face.cx, frame_w - face.cx)
    smallest = face.h * config.PANEL_ZOOM_MIN * aspect
    width = max(min(width, 2 * room), smallest)
    height = width / aspect

    # ប្រអប់តូចពេកសម្រាប់ផ្ទាំង -> **ពង្រីកប្រអប់** (យកបរិបទបន្ថែម) ជំនួសការផ្លុំរូប។
    # ផ្ទាំងធំនៃ `three` (1080×1280) ត្រូវការ crop 360×427 ទើបនៅក្នុងដែន 3x;
    # មុខ 96px × zoom 3 ផ្តល់តែ 243×288 ដែលត្រូវផ្លុំ 4.44x។
    if kind is not None:
        rects = panel_rects(kind)
        if rects:
            panel_w, panel_h = panel_inner(rects[min(index, len(rects) - 1)])
            grow = max(panel_w / config.PANEL_MAX_UPSCALE / max(1.0, width),
                       panel_h / config.PANEL_MAX_UPSCALE / max(1.0, height))
            if grow > 1.0:
                # ១% បន្ថែម ព្រោះទំហំត្រូវបង្គត់**ចុះ**ទៅលេខគូ (426 ពី 426.67)
                # ហើយការបង្គត់នោះធ្វើឲ្យការពង្រីកលើសដែនបន្តិច (3.0047x)។
                width, height = width * grow * 1.01, height * grow * 1.01
                # តែកុំពង្រីកហួស — ផ្ទាំងដែលមុខតូចល្អិតគ្មានតម្លៃទេ
                ceiling = face.h * config.PANEL_ZOOM_MAX
                if height > ceiling:
                    height = ceiling
                    width = height * aspect

    if width > frame_w:                       # រូបតូចពេក -> កំណត់ដោយទទឹង
        width = frame_w
        height = width / aspect
    if height > frame_h:                      # ...ឬដោយកម្ពស់
        height = frame_h
        width = height * aspect

    x = face.cx - width / 2
    y = face.cy - height * 0.40
    return _clamp_box(x, y, width, height, frame_w, frame_h)


def panel_inner(rect: tuple[int, int, int, int]) -> tuple[int, int]:
    """ទំហំ **រូបភាព** ក្នុងផ្ទាំង — ផ្ទាំងដកគម្លាត (card style)."""
    _, _, panel_w, panel_h = rect
    gap = max(0, config.PANEL_GAP)
    return _even(max(2, panel_w - gap)), _even(max(2, panel_h - gap))


def panel_upscale(box: Box, kind: str = "split", index: int = 0) -> float:
    """ត្រូវពង្រីកប្រអប់នេះប៉ុន្មានដងទើបពេញផ្ទាំងទី `index` នៃ layout នោះ?"""
    rects = panel_rects(kind)
    if not rects:
        return 1.0
    panel_w, panel_h = panel_inner(rects[min(index, len(rects) - 1)])
    return max(panel_w / max(1, box.w), panel_h / max(1, box.h))


def panels_sharp_enough(*boxes: Box, kind: str = "split",
                        limit: float | None = None) -> bool:
    """ផ្ទាំងទាំងអស់នៅក្នុងដែនពង្រីកដែលទទួលយកបានឬទេ?"""
    limit = config.PANEL_MAX_UPSCALE if limit is None else limit
    return all(panel_upscale(box, kind, index) <= limit
               for index, box in enumerate(boxes))


def pick_panel_faces(faces: list[Face], count: int, frame_w: int) -> list[Face] | None:
    """យកមុខ `count` សម្រាប់ផ្ទាំង — ធំជាងគេមុន រួចតម្រៀបពីឆ្វេងទៅស្តាំ.

    `None` បើមុខជិតគ្នាពេក (មុខជាន់គ្នាក្នុងផ្ទាំងពីរ មើលទៅចម្លែក)។
    """
    if len(faces) < count:
        return None
    chosen = sorted(sorted(faces, key=lambda f: f.w, reverse=True)[:count],
                    key=lambda f: f.cx)
    gaps = [b.cx - a.cx for a, b in zip(chosen, chosen[1:])]
    if any(gap < frame_w * config.MIN_FACE_SEPARATION for gap in gaps):
        return None
    return chosen


def single_box(face: Face, frame_w: int, frame_h: int,
               aspect: float | None = None) -> Box:
    """ប្រអប់ 9:16 ពេញកម្ពស់ ដែលមានមុខនៅកណ្តាលផ្ដេក (សម្រាប់ close-up)."""
    aspect = (config.OUT_WIDTH / config.OUT_HEIGHT) if aspect is None else aspect
    height = frame_h
    width = height * aspect
    if width > frame_w:
        width = frame_w
        height = width / aspect
    return _clamp_box(face.cx - width / 2, (frame_h - height) / 2,
                      width, height, frame_w, frame_h)


def center_box(frame_w: int, frame_h: int) -> Box:
    """ប្រអប់ 9:16 នៅកណ្តាល — ឥរិយាបថចាស់, ប្រើពេលចាប់មុខមិនបាន."""
    aspect = config.OUT_WIDTH / config.OUT_HEIGHT
    if frame_w / frame_h > aspect:
        height, width = frame_h, frame_h * aspect
    else:
        width, height = frame_w, frame_w / aspect
    return _clamp_box((frame_w - width) / 2, (frame_h - height) / 2,
                      width, height, frame_w, frame_h)


# ---------- ការតាមដានមុខក្នុង shot (crop ដែលរំកិល) ----------

def face_movement(faces: list[Face], frame_w: int) -> float:
    """ចលនាផ្ដេកធំបំផុតរវាងមុខទាំងនេះ ជាភាគរយនៃទទឹងរូប."""
    if len(faces) < 2:
        return 0.0
    centres = [f.cx for f in faces]
    return (max(centres) - min(centres)) / frame_w


def track_times(start: float, end: float, step: float | None = None,
                max_points: int | None = None) -> list[float]:
    """ពេលវេលាដែលត្រូវទាញ frame ពេលតាមដាន — ច្រើនជាង `sample_times` ហើយជៀសគែម.

    គែម shot ជាកន្លែងកាមេរ៉ាកាត់ ដូច្នេះ frame នៅទីនោះអាចនៅជារូបនៃ shot មុន។
    `max_points` ទប់កុំឲ្យ expression វែងពេកលើ shot វែង (៦០ វិនាទីគ្មានការកាត់)។
    """
    step = config.TRACK_SAMPLE_SEC if step is None else step
    max_points = config.TRACK_MAX_POINTS if max_points is None else max_points

    span = max(0.0, end - start)
    edge = min(0.2, span / 4)
    first, last = start + edge, end - edge
    if last <= first:
        return [(start + end) / 2]

    count = int((last - first) / max(step, 1e-6)) + 1
    count = max(2, min(max_points, count))
    gap = (last - first) / (count - 1)
    return [first + gap * i for i in range(count)]


def track_face_centres(video_path: Path, start: float, end: float,
                       size: tuple[int, int]) -> list[tuple[float, float]]:
    """(ពេលធៀបនឹងដើម shot, កណ្តាលមុខ x) រាល់ frame គំរូដែលឃើញមុខ.

    ពេលធៀបនឹង**ដើម shot** ព្រោះ `render.py` ដាក់ `setpts=PTS-STARTPTS` លើ shot
    នីមួយៗ ដូច្នេះ `t` ក្នុង filter ចាប់ផ្តើមពី 0 រាល់ shot។
    """
    tracked: list[tuple[float, float]] = []
    for moment in track_times(start, end):
        faces = detect_faces(video_path, moment, size)
        if faces:
            biggest = max(faces, key=lambda f: f.w)
            tracked.append((moment - start, biggest.cx))
    return tracked


def moving_average(points: list[tuple[float, float]],
                   window: int | None = None) -> list[tuple[float, float]]:
    """ធ្វើឲ្យគន្លងរលូន — detector រញ្ជួយបន្តិចរាល់ frame ហើយ crop ដែលញ័រមើលមិនបាន."""
    window = config.TRACK_SMOOTH_WINDOW if window is None else window
    if window <= 1 or len(points) < 3:
        return list(points)

    half = window // 2
    smoothed: list[tuple[float, float]] = []
    for index, (moment, _) in enumerate(points):
        near = [x for _, x in points[max(0, index - half):index + half + 1]]
        smoothed.append((moment, sum(near) / len(near)))
    return smoothed


def apply_deadzone(points: list[tuple[float, float]],
                   deadzone_px: float) -> list[tuple[float, float]]:
    """ទុកតែចំណុចដែលឃ្លាតពីចំណុចមុនគួរសម — ចលនាតូចមិនសមនឹងរំកិលកាមេរ៉ាទេ.

    ចំណុចដែលដកចេញនៅតែត្រូវឆ្លងកាត់ ព្រោះ expression ទាញបន្ទាត់ត្រង់រវាងចំណុច
    ដែលនៅសល់។ ចំណុចចុងក្រោយត្រូវបន្ថែមវិញ ដើម្បីកាន់តម្លៃដល់ចប់ shot។
    """
    if not points:
        return []

    kept = [points[0]]
    for moment, value in points[1:]:
        if abs(value - kept[-1][1]) >= deadzone_px:
            kept.append((moment, value))
    if kept[-1][0] < points[-1][0]:
        kept.append((points[-1][0], kept[-1][1]))
    return kept


def build_x_expression(points: list[tuple[float, float]]) -> str:
    """Expression របស់ FFmpeg ដែលគណនា x តាមពេល `t` (បន្ទាត់ត្រង់រវាងចំណុចវាស់បាន).

    FFmpeg គណនាវាឡើងវិញ**រាល់ frame** ដូច្នេះការរំកិលរលូន មិនមែនលោតទេ។ ទម្រង់៖
    `if(lt(t,t1), x0+(t-t0)*ជម្រាល, ...)` ហើយក្រោយចំណុចចុងក្រោយ x នៅនឹង។
    """
    if not points:
        return "0"
    if len(points) == 1:
        return f"{points[0][1]:.0f}"

    expression = f"{points[-1][1]:.0f}"          # ក្រោយចំណុចចុងក្រោយ: នៅនឹង
    for (t0, x0), (t1, x1) in reversed(list(zip(points, points[1:]))):
        slope = (x1 - x0) / max(1e-6, t1 - t0)
        expression = (f"if(lt(t,{t1:.3f}),"
                      f"{x0:.0f}+(t-{t0:.3f})*{slope:.2f},{expression})")

    first_t, first_x = points[0]
    if first_t > 0.001:                          # មុនចំណុចដំបូង: នៅនឹងដែរ
        expression = f"if(lt(t,{first_t:.3f}),{first_x:.0f},{expression})"
    return expression


def tracking_allowed(start: float, end: float) -> bool:
    """crop អាចតាមមុខក្នុង shot នេះបានទេ (menu Tracker).

    `TRACKING = False` បិទទាំងអស់; shot ដែលជាន់ចន្លោះមួយក្នុង `NO_TRACK_RANGES` ក៏បិទ.
    ឧ. ranges [(10, 12)] -> shot 8-11 s មិនតាមដាន, shot 12-15 s តាមដានធម្មតា.
    """
    if not config.TRACKING:
        return False
    return not any(a < end and b > start for a, b in config.NO_TRACK_RANGES)


def manual_box(track, start: float, end: float, size: tuple[int, int]) -> Box:
    """ប្រអប់ 9:16 ដែលរំកិលតាមផ្លូវដោយដៃ (`subject_track.Track`) ក្នុង shot [start, end).

    ពេលធៀបនឹងដើម shot ដូច `tracked_box` (render ដាក់ `setpts=PTS-STARTPTS`). ក្រោយចំណុចល្អ
    ចុងក្រោយ (ប្រធានបទត្រូវបាំង) x នៅនឹង — `build_x_expression` កាន់តម្លៃចុងក្រោយ.
    """
    frame_w, frame_h = size
    inside = [(t, cx) for t, cx, _ in track.points if start <= t <= end]
    centre = (sum(cx for _, cx in inside) / len(inside)) if inside else track.box[0] + track.box[2] / 2
    static = single_box(Face(x=int(centre), y=0, w=0, h=0, score=1.0), frame_w, frame_h)
    if len(inside) < 2:
        return static
    half = static.w / 2
    limit = float(frame_w - static.w)
    points = [(t - start, min(max(0.0, cx - half), limit)) for t, cx in inside]
    points = apply_deadzone(moving_average(points), frame_w * config.TRACK_DEADZONE)
    if len(points) < 2 or max(x for _, x in points) - min(x for _, x in points) < 2:
        return static
    average = _even_pos(sum(x for _, x in points) / len(points))
    return Box(x=average, y=static.y, w=static.w, h=static.h, x_expr=build_x_expression(points))


def tracked_box(video_path: Path, start: float, end: float,
                size: tuple[int, int], reference: Face) -> Box:
    """ប្រអប់ 9:16 ដែលរំកិលតាមមុខក្នុង shot នេះ.

    បើការតាមដានមិនបាន (ចាប់មុខបានតិចពេក ឬមុខស្ទើរនៅនឹង) ត្រឡប់ប្រអប់ថេរធម្មតា។
    """
    frame_w, frame_h = size
    static = single_box(reference, frame_w, frame_h)

    centres = track_face_centres(video_path, start, end, size)
    if len(centres) < 2:
        return static
    spread = max(x for _, x in centres) - min(x for _, x in centres)
    if spread / frame_w < config.TRACK_MOVE_THRESHOLD:
        return static              # frame ក្រាស់បង្ហាញថាវាស្ទើរនៅនឹង -> ប្រអប់ថេរ

    # x នៃប្រអប់ = កណ្តាលមុខ − ពាក់កណ្តាលទទឹងប្រអប់ ហើយកាត់ឲ្យនៅក្នុងរូប
    half = static.w / 2
    limit = float(frame_w - static.w)
    points = [(moment, min(max(0.0, cx - half), limit)) for moment, cx in centres]
    points = apply_deadzone(moving_average(points), frame_w * config.TRACK_DEADZONE)
    if len(points) < 2:
        return static
    if max(x for _, x in points) - min(x for _, x in points) < 2:
        return static

    # `x` ជាតម្លៃមធ្យម: កូដផ្សេង (ការគណនាការពង្រីក, test) នៅប្រើវាបាន
    average = _even_pos(sum(x for _, x in points) / len(points))
    return Box(x=average, y=static.y, w=static.w, h=static.h,
               x_expr=build_x_expression(points))


# ---------- កៅអី (seat) សកល ----------

def sample_times(start: float, end: float, count: int) -> list[float]:
    """ពេលវេលាគំរូបែងចែកស្មើគ្នាក្នុងចន្លោះ (ជៀសវាងគែមពិតប្រាកដ)."""
    if count <= 1:
        return [(start + end) / 2]
    span = end - start
    return [start + span * (i + 0.5) / count for i in range(count)]


def find_seats(video_path: Path, size: tuple[int, int], duration: float,
               samples: int | None = None,
               cache_path: Path | None = None) -> Seats | None:
    """ស្កេនទាំង video ដើម្បីរកទីតាំង "កៅអីឆ្វេង" និង "កៅអីស្តាំ" ក្នុង wide shot.

    ហេតុអ្វីស្កេនទាំង video? framing នៃ wide shot ដដែលពេញ episode។ ការប្រមូលពី frame
    ច្រើនធ្វើឲ្យទីតាំងស្ថិតស្ថេរ ទោះ detector ខកខានលើ frame ខ្លះ។ លទ្ធផល cache ទុក។
    """
    samples = config.SEAT_SAMPLE_FRAMES if samples is None else samples

    if cache_path is not None and Path(cache_path).is_file():
        try:
            data = json.loads(Path(cache_path).read_text(encoding="utf-8"))
            return Seats(left=Face(**data["left"]), right=Face(**data["right"]),
                         left_embedding=data.get("left_embedding", []),
                         right_embedding=data.get("right_embedding", []))
        except (json.JSONDecodeError, TypeError, KeyError, ValueError):
            pass      # cache ខូច -> ស្កេនថ្មី

    lefts: list[Face] = []
    rights: list[Face] = []
    left_embeddings: list[list[float]] = []
    right_embeddings: list[list[float]] = []

    for moment in sample_times(0.0, duration, samples):
        frame = grab_frame(video_path, moment, size)
        faces = detect_faces_in_frame(frame, size)
        if len(faces) != 2:
            continue      # យកតែ frame ដែលឃើញទាំងពីរនាក់ (wide shot)
        left, right = faces[0], faces[-1]
        if right.cx - left.cx < size[0] * config.MIN_FACE_SEPARATION:
            continue
        lefts.append(left)
        rights.append(right)
        # យក embedding ពី frame ដំបូងៗតែប៉ុណ្ណោះ — គ្រប់គ្រាន់ ហើយលឿន
        if len(left_embeddings) < 3:
            left_embeddings.append(face_embedding(frame, left))
            right_embeddings.append(face_embedding(frame, right))

    if len(lefts) < config.MIN_SEAT_SAMPLES:
        return None

    seats = Seats(
        left=_median_face(lefts), right=_median_face(rights),
        left_embedding=_average_embedding(left_embeddings),
        right_embedding=_average_embedding(right_embeddings),
    )
    if cache_path is not None:
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        Path(cache_path).write_text(
            json.dumps({"samples": len(lefts), **asdict(seats)}, indent=2),
            encoding="utf-8",
        )
    return seats


def _average_embedding(embeddings: list[list[float]]) -> list[float]:
    """មធ្យមនៃ embedding ច្រើន — ធន់នឹង frame ណាមួយដែលមុខទ្រេតខ្លាំង."""
    usable = [e for e in embeddings if e]
    if not usable:
        return []
    length = len(usable[0])
    return [sum(e[i] for e in usable) / len(usable) for i in range(length)]


def _median_face(faces: list[Face]) -> Face:
    """មុខ "មធ្យម" — median ធន់នឹងតម្លៃលោតជាង mean."""
    def mid(values: list[float]) -> int:
        ordered = sorted(values)
        return int(ordered[len(ordered) // 2])

    return Face(
        x=mid([f.x for f in faces]), y=mid([f.y for f in faces]),
        w=mid([f.w for f in faces]), h=mid([f.h for f in faces]),
        score=round(sum(f.score for f in faces) / len(faces), 3),
    )


# ---------- ឈ្មោះ layout ដែលអ្នកប្រើជ្រើសបាន ----------

# ឈ្មោះខាងក្នុង: "split" (ពីរផ្ទាំង), "single" (crop តាមមុខ), "center" (crop កណ្តាល)។
# យើងទទួលឈ្មោះក្រៅផងដែរ ព្រោះ tool ផ្សេង (OpusClip) ហៅ "single" ថា "fill"។
LAYOUT_ALIASES = {
    "split": "split", "two": "split",
    "three": "three", "four": "four",
    "single": "single", "face": "single", "fill": "single",
    "center": "center", "centre": "center",
    "fit": "fit",
    "screen": "screen", "screenshare": "screen",
}
# `auto` = អនុញ្ញាតទាំងអស់ ហើយ planner រើសក្នុងមួយ shot (shot មកពី scene detection)។
# វាស់មុនបើក three/four ក្នុង auto: podcast ៣ នាក់ប្តូរ 34s ពី split ទៅ three
# (ត្រឹមត្រូវ — មានមនុស្ស ៣ នាក់ក្នុងរូប) ហើយបទសម្ភាសន៍ ២ នាក់មិនប្តូរសោះ។
ALL_LAYOUTS = frozenset({"split", "three", "four", "single", "fit", "center", "screen"})
MULTI_PANEL = ("four", "three", "split")


def parse_layouts(value: str) -> frozenset[str]:
    """បម្លែង `--layout` ទៅជាសំណុំ layout ដែលអនុញ្ញាត.

    `"auto"` ឬទទេ = ទាំងអស់។ `"fill,split"` = តែពីរនោះ។ Planner រើសក្នុងចំណោម
    ទាំងនេះក្នុងមួយ shot — ដូច្នេះអ្នកកំណត់ *អ្វីដែលអាច* ហើយវារើស *អ្វីដែលសម*។
    """
    text = (value or "auto").strip().lower()
    if text in ("", "auto"):
        return ALL_LAYOUTS

    allowed = set()
    for part in text.split(","):
        name = part.strip()
        if not name:
            continue
        if name not in LAYOUT_ALIASES:
            known = ", ".join(sorted(LAYOUT_ALIASES))
            raise ValueError(f"layout មិនស្គាល់: {part.strip()!r} (ត្រូវជា auto, {known})")
        allowed.add(LAYOUT_ALIASES[name])
    if not allowed:
        raise ValueError("--layout ទទេ")
    return frozenset(allowed)



# ---------- ពេលគ្មានមុខ: រូបកាយ / សត្វ / ចលនា ----------

def head_of(subject) -> Face:
    """បម្លែងប្រអប់ **រូបកាយ** ទៅជា `Face` ក្លែងក្លាយនៅត្រង់ក្បាល.

    ហេតុអ្វី? កូដទាំងអស់ខាងក្រោម (`single_box`, `panel_box`, ការតាមដាន) និយាយ
    ភាសា `Face` រួចហើយ។ ប្រអប់រូបកាយ 574×663 ដែលយកកណ្តាលនឹងដាក់ crop លើ
    **ទ្រូង** ដូច្នេះយើងយកត្រឹម ២៥% ខាងលើជា "ក្បាល"។
    """
    height = max(2, int(subject.h * config.SUBJECT_HEAD_RATIO))
    width = max(2, int(height * 0.75))
    return Face(x=int(subject.cx - width / 2), y=subject.y,
                w=width, h=height, score=subject.score)


def fallback_layout(video_path: Path, start: float, end: float, size: tuple[int, int],
                    frames: list, sampled: int,
                    allowed: frozenset[str]) -> Layout | None:
    """Layout សម្រាប់ shot ដែលគ្មានមុខ — `None` បើគ្មានអ្វីល្អជាង center.

    លំដាប់: **រូបកាយ/សត្វ -> slide ស្ងៀម (fit) -> ចលនា**។

    `frames` ជា frame ដែល `plan_shot` ទាញរួចហើយ — យើងប្រើឡើងវិញ ព្រោះការទាញ
    frame ជាផ្នែកដែលថ្លៃបំផុត (ការចាប់វត្ថុខ្លួនឯងត្រឹម ~175ms)។
    """
    from pipeline.subjects import detect_subjects_in_frame, motion_centre, motion_level

    frame_w, frame_h = size
    seen: list = []
    for frame in frames:
        found = detect_subjects_in_frame(frame, size)
        if found:
            seen.append(max(found, key=lambda s: s.area))

    # ដែនវត្តមានដូចមុខដែរ: វត្ថុដែលលេចតែម្តងមិនគួរគ្រប់គ្រង shot ទាំងមូលទេ
    if seen and len(seen) >= sampled * config.FACE_PRESENCE_MIN and "single" in allowed:
        head = head_of(max(seen, key=lambda s: s.area))
        return Layout(kind="single", box=single_box(head, frame_w, frame_h))

    # គ្មានមនុស្ស **ហើយរូបស្ងៀម** = slide/អេក្រង់ -> បង្ហាញរូបពេញ កុំកាត់អក្សរ
    if "fit" in allowed and motion_level(video_path, start, end, size) < config.FIT_MOTION_MAX:
        return Layout(kind="fit")

    centre = motion_centre(video_path, start, end, size)
    if centre is None or "single" not in allowed:
        return None
    cx, cy = centre
    height = max(2, int(frame_h * 0.15))
    spot = Face(x=int(cx - height * 0.375), y=int(cy - height / 2),
                w=int(height * 0.75), h=height, score=0.0)
    return Layout(kind="single", box=single_box(spot, frame_w, frame_h))

# ---------- អេក្រង់ + webcam (layout `screen`) ----------

def is_webcam_face(face: Face, frame_w: int, frame_h: int) -> bool:
    """មុខតូចនៅជិតគែមឆ្វេង/ស្តាំ = មនុស្សក្នុងប្រអប់ webcam លើអេក្រង់ដែលចែករំលែក."""
    edge = frame_w * config.SCREEN_EDGE
    near_edge = face.cx < edge or face.cx > frame_w - edge
    return near_edge and face.h <= frame_h * config.SCREEN_FACE_MAX


def _longest_run(column, gap: int = 2) -> int:
    """ជួរ True វែងបំផុត ដោយអត់ឲ្យខ្វះ `gap` pixel (គែមខូចបន្តិចដោយ compression)."""
    best = run = miss = 0
    for on in column:
        if on:
            run = run + miss + 1 if run else 1
            miss = 0
            best = max(best, run)
        elif run:
            miss += 1
            if miss > gap:
                run = miss = 0
    return best


def tile_edge(frame, face: Face, frame_w: int) -> float:
    """គែមបញ្ឈរវែងបំផុតក្នុងផ្ទៃប្រអប់ webcam របស់មុខនេះ ÷ កម្ពស់មុខ.

    ប្រអប់ webcam ពិតជាចតុកោណ ដូច្នេះមានជួរឈរមួយដែលពន្លឺលោតពីជួរដេកមួយទៅជួរដេកមួយ
    ច្រើនដងកម្ពស់មុខ (How-AI-agents: 2.1-3.2). បន្ទប់ធម្មតាគ្មានទេ (0.2-0.7).
    """
    import cv2
    import numpy as np

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.int16)
    step = np.abs(np.diff(gray, axis=1)) >= config.SCREEN_EDGE_STEP
    half = face.w * config.SCREEN_TILE_RATIO / 2
    x0, x1 = max(0, int(face.cx - half)), min(step.shape[1], int(face.cx + half))
    longest = max((_longest_run(step[:, x]) for x in range(x0, x1)), default=0)
    return longest / max(face.h, 1)


def screen_region(faces: list[Face], frame_w: int) -> tuple[int, int]:
    """ផ្ទៃ x0..x1 ដែលគ្មានប្រអប់ webcam — ចន្លោះរវាងប្រអប់ (ឬពីប្រអប់ទៅគែមម្ខាងទៀត).

    ប្រអប់ webcam ≈ `SCREEN_TILE_RATIO` × ទទឹងមុខ ដាក់កណ្តាលលើមុខ.
    ឧ. មុខ cx=61 w=38 -> ប្រអប់ដល់ x=114; មុខ cx=592 -> ប្រអប់ចាប់ពី x=539.
    """
    left = [f.cx + f.w * config.SCREEN_TILE_RATIO / 2 for f in faces if f.cx < frame_w / 2]
    right = [f.cx - f.w * config.SCREEN_TILE_RATIO / 2 for f in faces if f.cx >= frame_w / 2]
    x0 = int(max(left, default=0))
    x1 = int(min(right, default=frame_w))
    return max(0, x0), min(frame_w, x1)


def slide_box(region: tuple[int, int], frame_w: int, frame_h: int, aspect: float) -> Box:
    """ប្រអប់ slide: ទទឹងពេញផ្ទៃ (អក្សរមិនដាច់), កម្ពស់តាមសមាមាត្រផ្ទាំងលើ, កណ្តាលបញ្ឈរ."""
    x0, x1 = region
    width = x1 - x0
    height = width / aspect
    if height > frame_h:
        height = frame_h
        width = height * aspect
    return _clamp_box((x0 + x1) / 2 - width / 2, (frame_h - height) / 2,
                      width, height, frame_w, frame_h)


def webcam_box(face: Face, frame_w: int, frame_h: int, aspect: float) -> Box:
    """ប្រអប់មនុស្សម្នាក់ **ក្នុង** ប្រអប់ webcam (កុំឲ្យលើសទៅលើ slide).

    ទទឹង <= ប្រអប់ webcam; កម្ពស់ <= 2.8 ដងកម្ពស់មុខ; មុខនៅ 40% ពីលើ។
    """
    tile = face.w * config.SCREEN_TILE_RATIO
    height = min(frame_h, face.h * config.SCREEN_TILE_RATIO)
    width = min(tile, height * aspect)
    height = width / aspect
    return _clamp_box(face.cx - width / 2, face.cy - height * 0.40, width, height,
                      frame_w, frame_h)


def screen_layout(video_path: Path, start: float, end: float, size: tuple[int, int],
                  faces: list[Face], biggest: Face | None, frame=None) -> Layout | None:
    """slide ខាងលើ + មនុស្ស webcam ខាងក្រោម, ឬ `None` បើ shot នេះមិនមែនអេក្រង់ចែករំលែក.

    លក្ខខណ្ឌទាំងអស់: មុខ ១-២ ជា webcam (តូច នៅគែម; ពីរនាក់ = ម្នាក់ម្ខាង), ផ្ទៃ slide
    ទូលាយគ្រប់គ្រាន់, ហើយផ្ទៃនោះ **ស្ងៀម** (slide មិនមែនវីដេអូ)។ ការពង្រីកមនុស្សមិនកំណត់
    ទេ — អ្នកអភិវឌ្ឍទទួលយក webcam ព្រិលលើវីដេអូ 360p ព្រោះ slide ជាអ្វីដែលគេអាន។
    """
    from pipeline.subjects import motion_level

    frame_w, frame_h = size
    if not 1 <= len(faces) <= 2:
        return None
    if not all(is_webcam_face(f, frame_w, frame_h) for f in faces):
        return None
    people = sorted(faces, key=lambda f: f.cx)
    if len(people) == 2 and not people[0].cx < frame_w / 2 <= people[1].cx:
        return None                  # ពីរនាក់ម្ខាងតែមួយ — មិនមែនទម្រង់នេះទេ
    region = screen_region(people, frame_w)
    if region[1] - region[0] < frame_w * config.SCREEN_MIN_WIDTH:
        return None
    # wide shot ពីរនាក់អង្គុយ ក៏មុខតូចនៅគែម ហើយបន្ទប់ស្ងៀមដែរ: ខុសគ្នាត្រង់គ្មានប្រអប់
    if frame is not None and any(tile_edge(frame, f, frame_w) < config.SCREEN_TILE_EDGE
                                 for f in people):
        return None

    kind = "screen1" if len(people) == 1 else "screen2"
    rects = panel_rects(kind)
    if not rects:
        return None                  # output ផ្ដេក (16:9)
    if motion_level(video_path, start, end, size, region=region) > config.SCREEN_MOTION_MAX:
        return None                  # ផ្ទៃនោះមានចលនា = វីដេអូ មិនមែន slide
    aspects = [w / h for w, h in (panel_inner(rect) for rect in rects)]
    panels = [slide_box(region, frame_w, frame_h, aspects[0])]
    panels += [webcam_box(face, frame_w, frame_h, aspects[i + 1])
               for i, face in enumerate(people)]
    return Layout(kind=kind, panels=panels,
                  box=single_box(biggest, frame_w, frame_h) if biggest else None)


# ---------- ផែនការ layout ----------

def identify(frame, face: Face, seats: Seats | None) -> str | None:
    """មុខនេះជាអ្នកណា — "left", "right", ឬ None បើមិនច្បាស់.

    **ហេតុអ្វីមិនប្រើទីតាំង x?** ក្នុង close-up កាមេរ៉ាដាក់មនុស្សនៅកណ្តាលរូប ដូច្នេះ
    ទីតាំងមិនប្រាប់អ្វីទេ។ យើងប្រៀបធៀបមុខនឹង embedding នៃកៅអីនីមួយៗវិញ។
    """
    if seats is None or not seats.left_embedding or not seats.right_embedding:
        return None
    try:
        embedding = face_embedding(frame, face)
    except ReframeError:
        return None
    if not embedding:
        return None

    left_score = cosine_similarity(seats.left_embedding, embedding)
    right_score = cosine_similarity(seats.right_embedding, embedding)
    best = max(left_score, right_score)
    if best < config.FACE_MATCH_THRESHOLD:
        return None            # មនុស្សទីបី ឬមុខមិនច្បាស់
    return "left" if left_score > right_score else "right"


def plan_shot(video_path: Path, start: float, end: float, size: tuple[int, int],
              seats: Seats | None = None,
              allowed: frozenset[str] | None = None) -> Layout:
    """សម្រេច layout សម្រាប់ shot មួយ ដោយមើល frame គំរូពីរបី.

    `allowed` = layout ដែលអ្នកប្រើអនុញ្ញាត។ `center` ជាទីពឹងចុងក្រោយជានិច្ច —
    បើគ្មានមុខ ហើយគ្មាន layout ណាសម យើងនៅតែត្រូវបញ្ចេញរូបមួយ។
    """
    frame_w, frame_h = size
    allowed = ALL_LAYOUTS if allowed is None else allowed

    if allowed == frozenset({"center"}):
        return Layout(kind="center", box=center_box(frame_w, frame_h))

    # អ្នកជ្រើសប្រធានបទក្នុង scene នេះដោយដៃ (Manual subject tracking) -> តាមវា, មិនសួរ AI ទេ
    from pipeline.subject_track import tracks_for_shot
    manual = tracks_for_shot(start, end)
    if manual is not None:
        return Layout(kind="single", box=manual_box(manual, start, end, size))

    best: list[Face] = []
    best_frame = None
    seen: list[Face] = []          # មុខធំបំផុតក្នុង frame គំរូនីមួយៗ — ប្រើធៀបចលនា
    sampled = 0
    frames = []                    # ប្រើឡើងវិញសម្រាប់ការរក subject (ការទាញ frame ថ្លៃជាងគេ)
    for moment in sample_times(start, end, config.SHOT_SAMPLE_FRAMES):
        sampled += 1
        frame = grab_frame(video_path, moment, size)
        if frame is not None:
            frames.append(frame)
        faces = detect_faces_in_frame(frame, size)
        if faces:
            seen.append(max(faces, key=lambda f: f.w))
        if len(faces) > len(best):
            best, best_frame = faces, frame
        if len(best) >= 2:
            break      # ឃើញពីរនាក់រួចហើយ — គ្រប់គ្រាន់

    biggest = max(best, key=lambda f: f.w) if best else None

    # អេក្រង់ចែករំលែក + webcam តូចនៅគែម -> slide ខាងលើ, មនុស្សខាងក្រោម។ សាកមុនផ្ទាំង
    # មនុស្ស: split/three បោះ slide ចោល (How-AI-agents មុននេះ: single ១០/១០ clips)
    if "screen" in allowed and best:
        screen = screen_layout(video_path, start, end, size, best, biggest, best_frame)
        if screen is not None:
            return screen

    # ផ្ទាំងច្រើន: សាកចំនួនផ្ទាំងច្រើនជាងគេមុន (four -> three -> split)
    # ប្រអប់គណនាពីមុខ **ក្នុង shot នេះ** មិនមែនពីកៅអីសកលទេ។ កៅអីជាមធ្យមលើទាំង
    # video ដែលលាយ framing ច្រើន — វាស់ពិត: មុខកៅអី h=108 ខណៈមុខពិតក្នុង shot
    # h=182 ហើយប្រអប់តូចនោះដាក់មុខជាប់គែមផ្ទាំង។ កៅអីនៅប្រើសម្រាប់
    # **សម្គាល់អ្នកណា** (`identify`) ដែលជាកន្លែងវាល្អជាង។
    for kind in MULTI_PANEL:
        count = PANEL_GRIDS[kind]
        if kind not in allowed or len(best) < count:
            continue
        # split រក្សាឥរិយាបថចាស់: មុខឆ្វេងបំផុត + ស្តាំបំផុត (លទ្ធផលដែលអនុម័តរួច)
        chosen = ([best[0], best[-1]] if kind == "split"
                  else pick_panel_faces(best, count, frame_w))
        if chosen is None:
            continue
        if kind == "split" and chosen[1].cx - chosen[0].cx < frame_w * config.MIN_FACE_SEPARATION:
            continue
        if kind == "three":
            # ផ្ទាំងធំខាងលើទទួល **អ្នកនិយាយមេ** (មុខធំជាងគេ) រួចពីរនាក់ទៀត
            # តម្រៀបឆ្វេង-ស្តាំនៅជួរក្រោម
            lead = max(chosen, key=lambda f: f.w)
            chosen = [lead] + [f for f in chosen if f is not lead]
        boxes = [panel_box(f, frame_w, frame_h, kind=kind, index=i)
                 for i, f in enumerate(chosen)]
        if not panels_sharp_enough(*boxes, kind=kind):
            continue          # ព្រិលពេក -> សាកផ្ទាំងតិចជាង រួចទើប single
        # box បម្រុង: បើ layout នេះខ្លីពេក `smooth_segments` ប្តូរទៅ single
        # ដោយប្រើប្រអប់នេះ ដែលគណនាពី frame របស់ shot នេះផ្ទាល់។
        return Layout(kind=kind, panels=boxes,
                      box=single_box(biggest, frame_w, frame_h))

    # អនុញ្ញាតតែផ្ទាំងច្រើន (គ្មាន single/center) -> បង្ខំវា ទោះមុខតិច ឬព្រិល
    forced = [k for k in MULTI_PANEL if k in allowed]
    if forced and not ({"single", "center"} & allowed):
        kind = forced[0]
        chosen = pick_panel_faces(best, PANEL_GRIDS[kind], frame_w)
        if chosen is None and seats and kind == "split":
            chosen = [seats.left, seats.right]
        if chosen:
            return Layout(kind=kind,
                          panels=[panel_box(f, frame_w, frame_h, kind=kind, index=i)
                                  for i, f in enumerate(chosen)],
                          box=single_box(biggest, frame_w, frame_h) if biggest else None)

    # មុខ **ធំជាងគេ** ជាប្រធានបទ មិនមែនមុខឆ្វេងបំផុតទេ — ក្នុង frame ដែលមានទាំង
    # មនុស្ស ទាំងរូបថតលើជញ្ជាំង ការយកឆ្វេងបំផុតអាចដាក់ crop លើធ្នើរ។
    # មុខលេចក្នុង frame គំរូតិចពេក -> ប្រអប់ថេរនឹងតាមមុខដែលបាត់ទៅហើយ។
    # (វាស់ពិត: shot ១៤.៨ វិនាទី, មុខលេចតែ frame ដំបូង, crop កាត់ក្បាលចេញ។)
    present_enough = seen and len(seen) >= sampled * config.FACE_PRESENCE_MIN

    if best and present_enough and "single" in allowed:
        subject = max(best, key=lambda f: f.w)
        # បើ frame គំរូបង្ហាញថាមុខផ្លាស់ទី ប្រអប់ថេរនឹងកាត់មុខចេញ។
        # ពេលនោះ យើងយក frame បន្ថែម រួចធ្វើ crop ដែលរំកិលតាមមុខ។
        if tracking_allowed(start, end) and face_movement(seen, frame_w) > config.TRACK_MOVE_THRESHOLD:
            box = tracked_box(video_path, start, end, size, subject)
        else:
            box = single_box(subject, frame_w, frame_h)
        return Layout(kind="single", box=box,
                      person=identify(best_frame, subject, seats))

    # គ្មានមុខដែលទុកចិត្តបាន -> រូបកាយ/សត្វ, slide, រួចចលនា។ center ជាទីពឹងចុងក្រោយ។
    if config.USE_SUBJECTS and ({"single", "fit"} & allowed):
        spare = fallback_layout(video_path, start, end, size, frames, sampled, allowed)
        if spare is not None:
            return spare

    return Layout(kind="center", box=center_box(frame_w, frame_h))


def smooth_segments(segments: list[Segment],
                    min_split_sec: float | None = None,
                    allowed: frozenset[str] | None = None,
                    size: tuple[int, int] | None = None) -> list[Segment]:
    """ដក layout ដែលលោតឡើងមួយភ្លែត រួចបញ្ចូល segment ដែលដូចគ្នា.

    ការប្តូរ layout ជាការប្តូររូបភាពធំ។ បើវាមានតែ ២-៣ វិនាទី អ្នកមើលឃើញជាការភ្លឹបភ្លែត
    មិនមែនជាជម្រើសរចនាទេ។ យើងបន្ទាបវាទៅ single (ដោយប្រើប្រអប់បម្រុងដែលគណនាពី
    shot នោះផ្ទាល់) រួចបញ្ចូល segment ជាប់គ្នាដែលមាន layout ដូចបេះបិទ។

    បើ `--layout` មិនអនុញ្ញាត single (`allowed` គ្មាន "single") ការបន្ទាបទៅ center វិញ — ធ្លាប់
    ទៅ single ដោយស្ងាត់ ហើយ reframe ដែល Fill បិទមាន crop តាមមុខ 8% (វាស់លើវីដេអូរមាស)។
    """
    to_center = allowed is not None and "single" not in allowed and size is not None
    min_split_sec = config.MIN_SPLIT_SEC if min_split_sec is None else min_split_sec

    cleaned: list[Segment] = []
    for segment in segments:
        layout = segment.layout
        if (layout.kind in PANEL_GRIDS and segment.duration < min_split_sec
                and layout.box is not None):
            if to_center:
                layout = Layout(kind="center", box=center_box(*size))
            else:
                layout = Layout(kind="single", box=layout.box, person=layout.person)
        cleaned.append(Segment(start=segment.start, end=segment.end, layout=layout))

    merged: list[Segment] = []
    for segment in cleaned:
        if merged and _same_layout(merged[-1].layout, segment.layout):
            merged[-1] = Segment(start=merged[-1].start, end=segment.end,
                                 layout=merged[-1].layout)
        else:
            merged.append(segment)
    return merged


def _same_layout(a: Layout, b: Layout) -> bool:
    return a.kind == b.kind and a.panels == b.panels and a.box == b.box


def plan_clip(video_path: Path, clip: Clip, size: tuple[int, int],
              seats: Seats | None = None,
              allowed: frozenset[str] | None = None) -> list[Segment]:
    """ចែក clip ជា shot រួចសម្រេច layout ក្នុងមួយ shot.

    `allowed` = សំណុំពី `parse_layouts()`។ `None` = ទាំងអស់។
    """
    allowed = ALL_LAYOUTS if allowed is None else allowed

    if config.TRANSFORM is not None:
        # Transform ដោយដៃ ជំនួស AI: segment មួយ (ទីតាំងថេរ) — មិនបាច់រក shot ឬមុខ
        return [Segment(start=clip.start, end=clip.end, layout=custom_layout(config.TRANSFORM, size))]

    if allowed == frozenset({"center"}):
        # center តែមួយ -> មិនបាច់រកការកាត់ camera ឬមុខទេ (លឿន)
        frame_w, frame_h = size
        return [Segment(start=clip.start, end=clip.end,
                        layout=Layout(kind="center", box=center_box(frame_w, frame_h)))]

    cuts = detect_cuts(video_path, clip.start, clip.end)
    shots = split_into_shots(clip.start, clip.end, cuts)
    # shot នីមួយៗឯករាជ្យ ហើយពេលភាគច្រើនចំណាយលើការរង់ចាំ FFmpeg ទាញ frame ->
    # thread ជួយបានច្រើន (ការវិភាគ 47 នាទីធ្លាក់ពី ~8 នាទីមកតិចជាង)។
    workers = max(1, min(config.PLAN_WORKERS, len(shots)))
    if workers == 1:
        layouts = [plan_shot(video_path, a, b, size, seats, allowed) for a, b in shots]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            layouts = list(pool.map(
                lambda shot: plan_shot(video_path, shot[0], shot[1], size, seats, allowed),
                shots,
            ))
    segments = [Segment(start=a, end=b, layout=layout)
                for (a, b), layout in zip(shots, layouts)]
    segments = smooth_segments(segments, allowed=allowed, size=size)
    return order_split_panels(segments, size, seats)


def custom_layout(transform, size: tuple[int, int]) -> Layout:
    """Layout `custom` ពី Transform: crop ជា pixel នៃវីដេអូដើម + ទំហំ/ទីតាំងលើ output."""
    from pipeline import transform as tf

    frame_w, frame_h = size
    x, y, w, h = tf.crop_pixels(transform, frame_w, frame_h)
    fg = tf.foreground_size(transform, frame_w, frame_h, config.OUT_WIDTH)
    left, top = tf.top_left(transform, fg, config.OUT_WIDTH, config.OUT_HEIGHT)
    return Layout(kind="custom", box=Box(x, y, w, h), place=(fg[0], fg[1], left, top))


def order_split_panels(segments: list[Segment], size: tuple[int, int],
                       seats: Seats | None) -> list[Segment]:
    """សម្រេចថាអ្នកណានៅផ្ទាំងលើ (តាមរបៀប OpusClip).

    OpusClip ដាក់អ្នកនិយាយនៅលើ។ យើងគ្មាន diarization តែ **អ្នកកាត់តវីដេអូបានកាត់ទៅ
    អ្នកនិយាយរួចហើយ** — ដូច្នេះ close-up ប្រាប់យើងថាអ្នកណាកំពុងនិយាយ។ យើងរាប់ថា
    អ្នកណាបាន close-up យូរជាងក្នុង clip នេះ (តាមការសម្គាល់មុខ) រួចដាក់អ្នកនោះនៅលើ។
    """
    if config.SPLIT_TOP == "right":
        return [_swap_panels(s) for s in segments]
    if config.SPLIT_TOP == "left" or seats is None:
        return segments

    close_up_time = {"left": 0.0, "right": 0.0}
    for segment in segments:
        if segment.layout.kind == "single" and segment.layout.person in close_up_time:
            close_up_time[segment.layout.person] += segment.duration

    # ស្មើគ្នា ឬគ្មាន close-up -> ទុកឆ្វេងនៅលើ (ជម្រើសដែលអាចទាយទុកជាមុន)
    if close_up_time["right"] > close_up_time["left"]:
        return [_swap_panels(s) for s in segments]
    return segments


def _swap_panels(segment: Segment) -> Segment:
    if segment.layout.kind != "split":
        return segment
    layout = segment.layout
    return Segment(start=segment.start, end=segment.end,
                   layout=Layout(kind="split", panels=[layout.bottom, layout.top],
                                 box=layout.box, person=layout.person))


def describe(segments: list[Segment]) -> str:
    """សង្ខេបខ្លីសម្រាប់បង្ហាញក្នុង CLI, ឧ. "split 12s, single 8s, center 3s"."""
    totals: dict[str, float] = {}
    for segment in segments:
        totals[segment.layout.kind] = totals.get(segment.layout.kind, 0.0) + segment.duration
    order = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    return ", ".join(f"{kind} {seconds:.0f}s" for kind, seconds in order)


def save_layout_summary(segments: list[Segment], path: Path, captions: bool = True,
                        allowed: frozenset[str] | None = None) -> Path:
    """សរសេរ layout របស់ shot នីមួយៗ (`clip_XX_layout.json`) — screen Subtitles ត្រូវដឹងថា
    shot ណាជា split ដើម្បីដាក់ caption preview លើស្នាម ដូច render ពិត. មុននេះ ផែនការត្រូវបាន
    គណនាពេល render ហើយបោះចោល ហើយ preview ដាក់ caption ពីលើមុខមនុស្សទីពីរ (ឃើញពិត).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # `captions`: caption ត្រូវបានដុតឬអត់ — `--no-captions` នៅតែសរសេរ .ass (សម្រាប់ .srt/.vtt)
    # ដូច្នេះ .ass មិនមែនជាភស្តុតាងទេ (Result បានសរសេរ "ដុតរួច" ខុស)
    # `allowed`: layout ដែល --layout អនុញ្ញាត — បើគ្មាន "single" AI មិនតាមដាន subject ទេ
    # (ឃើញពិត: --layout fit លើវីដេអូរមាស = center ទាំង 55.7 s) ហើយ Result ត្រូវប្រាប់ពីរឿងនេះ
    data = {"dominant": dominant_kind(segments), "captions": captions,
            "allowed": sorted(allowed) if allowed is not None else None,
            "shots": [{"start": round(s.start, 3), "end": round(s.end, 3), "kind": s.layout.kind}
                      for s in segments]}
    path.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return path


def dominant_kind(segments: list[Segment]) -> str:
    """layout ដែលកាន់កាប់ពេលវែងជាងគេ (ប្រើសម្រាប់ទីតាំង caption)."""
    if not segments:
        return "center"
    totals: dict[str, float] = {}
    for segment in segments:
        totals[segment.layout.kind] = totals.get(segment.layout.kind, 0.0) + segment.duration
    return max(totals.items(), key=lambda kv: kv[1])[0]
