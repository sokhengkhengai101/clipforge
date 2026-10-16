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

    kind: str                      # "split" | "three" | "four" | "single" | "center"
    panels: list[Box] = field(default_factory=list)
    box: Box | None = None         # single / center (និងប្រអប់បម្រុងរបស់ split)
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


def panel_geometry(kind: str) -> tuple[int, int, int, int]:
    """(ជួរឈរ, ជួរដេក, ទទឹងផ្ទាំង, កម្ពស់ផ្ទាំង) សម្រាប់ layout ច្រើនផ្ទាំង.

    ៤ ផ្ទាំងជាក្រឡា 2×2 ជានិច្ច ព្រោះ ៤ ជួរដេកលើ 1080×1920 ផ្តល់ផ្ទាំង 1080×480
    ដែលរាក់ពេកសម្រាប់ដាក់មុខ (បញ្ហាដូច 16:9 ក្នុងចំណាំ `--aspect`)។
    """
    out_w, out_h = config.OUT_WIDTH, config.OUT_HEIGHT
    count = PANEL_GRIDS.get(kind, 1)
    if count == 4:
        cols, rows = 2, 2
    elif config.SPLIT_DIRECTION == "horizontal":
        cols, rows = count, 1
    else:
        cols, rows = 1, count
    return cols, rows, out_w // cols, out_h // rows


def caption_margin_for(kind: str) -> int | None:
    """MarginV ដែលដាក់ប្លុកអក្សរកណ្តាលលើ **ស្នាមចុងក្រោយ** នៃ layout ច្រើនផ្ទាំង.

    `None` = ប្រើទីតាំងធម្មតា (lower third)។ ស្នាមជាកន្លែងតែមួយដែលអក្សរមិនបាំង
    មុខអ្នកណាម្នាក់ — OpusClip ធ្វើដូចគ្នាលើ split។
    """
    if kind not in PANEL_GRIDS or config.SPLIT_DIRECTION != "vertical":
        return None
    _, rows, _, _ = panel_geometry(kind)
    if rows < 2:
        return None
    seam = config.OUT_HEIGHT * (rows - 1) / rows
    block = config.CAPTION_MAX_LINES * config.CAPTION_FONT_SIZE * 1.1
    return max(0, int(config.OUT_HEIGHT - seam - block / 2))


def panel_box(face: Face, frame_w: int, frame_h: int,
              aspect: float | None = None, zoom: float | None = None,
              kind: str | None = None) -> Box:
    """ប្រអប់សម្រាប់ផ្ទាំងមួយក្នុង split (សមាមាត្រ 9:8 = 1.125).

    កម្ពស់ = កម្ពស់មុខ × `zoom` ដូច្នេះមុខមិនពេញអេក្រង់ពេក ហើយនៅមានបរិបទ។
    មុខត្រូវដាក់នៅ ~40% ពីលើ ដែលជាទម្រង់ធម្មតានៃ portrait។
    """
    if aspect is None:
        if kind is None:
            aspect = config.PANEL_ASPECT
        else:
            _, _, panel_w, panel_h = panel_geometry(kind)
            aspect = panel_w / panel_h
    zoom = config.PANEL_ZOOM if zoom is None else zoom

    height = min(frame_h, face.h * zoom)
    width = height * aspect

    # ប្រអប់ធំជាងទីធ្លាសងខាងមុខ -> `_clamp_box` រុញវាចូល ហើយមុខទៅជាប់គែមផ្ទាំង
    # (យើងឃើញពិត: មុខនៅ x=1100 ក្នុងរូប 1280 ទទឹង, ប្រអប់ 606 -> មុខនៅ 70%)។
    room = min(face.cx, frame_w - face.cx)
    smallest = face.h * config.PANEL_ZOOM_MIN * aspect
    width = max(min(width, 2 * room), smallest)
    height = width / aspect

    if width > frame_w:                       # រូបតូចពេក -> កំណត់ដោយទទឹង
        width = frame_w
        height = width / aspect

    x = face.cx - width / 2
    y = face.cy - height * 0.40
    return _clamp_box(x, y, width, height, frame_w, frame_h)


def panel_upscale(box: Box, kind: str = "split") -> float:
    """ត្រូវពង្រីកប្រអប់នេះប៉ុន្មានដងទើបពេញផ្ទាំងរបស់ layout នោះ?"""
    _, _, panel_w, panel_h = panel_geometry(kind)
    return max(panel_w / max(1, box.w), panel_h / max(1, box.h))


def panels_sharp_enough(*boxes: Box, kind: str = "split",
                        limit: float | None = None) -> bool:
    """ផ្ទាំងទាំងអស់នៅក្នុងដែនពង្រីកដែលទទួលយកបានឬទេ?"""
    limit = config.PANEL_MAX_UPSCALE if limit is None else limit
    return all(panel_upscale(box, kind) <= limit for box in boxes)


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
}
# `auto` = ឥរិយាបថដែលអ្នកប្រើបានអនុម័តរួច។ `three`/`four` ជា **opt-in** ព្រោះវា
# ប្តូររូបភាពច្រើន (`--layout fill,split,three`)។
ALL_LAYOUTS = frozenset({"split", "single", "center"})
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

    best: list[Face] = []
    best_frame = None
    seen: list[Face] = []          # មុខធំបំផុតក្នុង frame គំរូនីមួយៗ — ប្រើធៀបចលនា
    for moment in sample_times(start, end, config.SHOT_SAMPLE_FRAMES):
        frame = grab_frame(video_path, moment, size)
        faces = detect_faces_in_frame(frame, size)
        if faces:
            seen.append(max(faces, key=lambda f: f.w))
        if len(faces) > len(best):
            best, best_frame = faces, frame
        if len(best) >= 2:
            break      # ឃើញពីរនាក់រួចហើយ — គ្រប់គ្រាន់

    biggest = max(best, key=lambda f: f.w) if best else None

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
        boxes = [panel_box(f, frame_w, frame_h, kind=kind) for f in chosen]
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
                          panels=[panel_box(f, frame_w, frame_h, kind=kind) for f in chosen],
                          box=single_box(biggest, frame_w, frame_h) if biggest else None)

    # មុខ **ធំជាងគេ** ជាប្រធានបទ មិនមែនមុខឆ្វេងបំផុតទេ — ក្នុង frame ដែលមានទាំង
    # មនុស្ស ទាំងរូបថតលើជញ្ជាំង ការយកឆ្វេងបំផុតអាចដាក់ crop លើធ្នើរ។
    if best and "single" in allowed:
        subject = max(best, key=lambda f: f.w)
        # បើ frame គំរូបង្ហាញថាមុខផ្លាស់ទី ប្រអប់ថេរនឹងកាត់មុខចេញ។
        # ពេលនោះ យើងយក frame បន្ថែម រួចធ្វើ crop ដែលរំកិលតាមមុខ។
        if face_movement(seen, frame_w) > config.TRACK_MOVE_THRESHOLD:
            box = tracked_box(video_path, start, end, size, subject)
        else:
            box = single_box(subject, frame_w, frame_h)
        return Layout(kind="single", box=box,
                      person=identify(best_frame, subject, seats))

    return Layout(kind="center", box=center_box(frame_w, frame_h))


def smooth_segments(segments: list[Segment],
                    min_split_sec: float | None = None) -> list[Segment]:
    """ដក layout ដែលលោតឡើងមួយភ្លែត រួចបញ្ចូល segment ដែលដូចគ្នា.

    ការប្តូរ layout ជាការប្តូររូបភាពធំ។ បើវាមានតែ ២-៣ វិនាទី អ្នកមើលឃើញជាការភ្លឹបភ្លែត
    មិនមែនជាជម្រើសរចនាទេ។ យើងបន្ទាបវាទៅ single (ដោយប្រើប្រអប់បម្រុងដែលគណនាពី
    shot នោះផ្ទាល់) រួចបញ្ចូល segment ជាប់គ្នាដែលមាន layout ដូចបេះបិទ។
    """
    min_split_sec = config.MIN_SPLIT_SEC if min_split_sec is None else min_split_sec

    cleaned: list[Segment] = []
    for segment in segments:
        layout = segment.layout
        if (layout.kind in PANEL_GRIDS and segment.duration < min_split_sec
                and layout.box is not None):
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
    segments = smooth_segments(segments)
    return order_split_panels(segments, size, seats)


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


def dominant_kind(segments: list[Segment]) -> str:
    """layout ដែលកាន់កាប់ពេលវែងជាងគេ (ប្រើសម្រាប់ទីតាំង caption)."""
    if not segments:
        return "center"
    totals: dict[str, float] = {}
    for segment in segments:
        totals[segment.layout.kind] = totals.get(segment.layout.kind, 0.0) + segment.duration
    return max(totals.items(), key=lambda kv: kv[1])[0]
