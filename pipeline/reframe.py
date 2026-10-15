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
    """ប្រអប់ crop (pixel ក្នុងរូបដើម). លេខគូទាំងអស់ ព្រោះ H.264 តម្រូវ."""

    x: int
    y: int
    w: int
    h: int

    def as_filter(self) -> str:
        return f"crop={self.w}:{self.h}:{self.x}:{self.y}"


@dataclass
class Layout:
    """របៀបដែល shot មួយត្រូវបម្លែងទៅ 9:16."""

    kind: str                      # "split" | "single" | "center"
    top: Box | None = None         # split តែប៉ុណ្ណោះ
    bottom: Box | None = None      # split តែប៉ុណ្ណោះ
    box: Box | None = None         # single / center
    person: str | None = None      # single: "left" / "right" / None (អ្នកណាក្នុង close-up)


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


def panel_box(face: Face, frame_w: int, frame_h: int,
              aspect: float | None = None, zoom: float | None = None) -> Box:
    """ប្រអប់សម្រាប់ផ្ទាំងមួយក្នុង split (សមាមាត្រ 9:8 = 1.125).

    កម្ពស់ = កម្ពស់មុខ × `zoom` ដូច្នេះមុខមិនពេញអេក្រង់ពេក ហើយនៅមានបរិបទ។
    មុខត្រូវដាក់នៅ ~40% ពីលើ ដែលជាទម្រង់ធម្មតានៃ portrait។
    """
    aspect = config.PANEL_ASPECT if aspect is None else aspect
    zoom = config.PANEL_ZOOM if zoom is None else zoom

    height = min(frame_h, face.h * zoom)
    width = height * aspect
    if width > frame_w:                       # រូបតូចពេក -> កំណត់ដោយទទឹង
        width = frame_w
        height = width / aspect

    x = face.cx - width / 2
    y = face.cy - height * 0.40
    return _clamp_box(x, y, width, height, frame_w, frame_h)


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
              seats: Seats | None = None, force: str | None = None) -> Layout:
    """សម្រេច layout សម្រាប់ shot មួយ ដោយមើល frame គំរូពីរបី."""
    frame_w, frame_h = size

    if force == "center":
        return Layout(kind="center", box=center_box(frame_w, frame_h))

    best: list[Face] = []
    best_frame = None
    for moment in sample_times(start, end, config.SHOT_SAMPLE_FRAMES):
        frame = grab_frame(video_path, moment, size)
        faces = detect_faces_in_frame(frame, size)
        if len(faces) > len(best):
            best, best_frame = faces, frame
        if len(best) >= 2:
            break      # ឃើញពីរនាក់រួចហើយ — គ្រប់គ្រាន់

    if len(best) >= 2:
        left, right = best[0], best[-1]
        if right.cx - left.cx >= frame_w * config.MIN_FACE_SEPARATION:
            # ប្រើ seat សកលបើមាន (ស្ថិតស្ថេរជាង) បើអត់ ប្រើមុខពី frame នេះ
            a, b = seats.as_tuple() if seats else (left, right)
            biggest = max(best, key=lambda f: f.w)
            return Layout(
                kind="split",
                top=panel_box(a, frame_w, frame_h),
                bottom=panel_box(b, frame_w, frame_h),
                # box បម្រុង: បើ split ខ្លីពេក យើងប្តូរទៅ single ដោយប្រើប្រអប់នេះ
                # ដែលគណនាពី frame របស់ shot នេះផ្ទាល់ (មិនមែនខ្ចីពី shot ផ្សេង)។
                box=single_box(biggest, frame_w, frame_h),
            )

    if force == "split" and seats:
        return Layout(kind="split",
                      top=panel_box(seats.left, frame_w, frame_h),
                      bottom=panel_box(seats.right, frame_w, frame_h))

    if best:
        return Layout(kind="single", box=single_box(best[0], frame_w, frame_h),
                      person=identify(best_frame, best[0], seats))

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
        if (layout.kind == "split" and segment.duration < min_split_sec
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
    return (a.kind == b.kind and a.top == b.top and a.bottom == b.bottom
            and a.box == b.box)


def plan_clip(video_path: Path, clip: Clip, size: tuple[int, int],
              seats: Seats | None = None,
              layout_mode: str = "auto") -> list[Segment]:
    """ចែក clip ជា shot រួចសម្រេច layout ក្នុងមួយ shot.

    `layout_mode`: "auto" (តាម detection), "center" (ឥរិយាបថចាស់), "split" (បង្ខំ).
    """
    if layout_mode == "center":
        frame_w, frame_h = size
        return [Segment(start=clip.start, end=clip.end,
                        layout=Layout(kind="center", box=center_box(frame_w, frame_h)))]

    cuts = detect_cuts(video_path, clip.start, clip.end)
    shots = split_into_shots(clip.start, clip.end, cuts)

    force = layout_mode if layout_mode in ("split", "center") else None
    # shot នីមួយៗឯករាជ្យ ហើយពេលភាគច្រើនចំណាយលើការរង់ចាំ FFmpeg ទាញ frame ->
    # thread ជួយបានច្រើន (ការវិភាគ 47 នាទីធ្លាក់ពី ~8 នាទីមកតិចជាង)។
    workers = max(1, min(config.PLAN_WORKERS, len(shots)))
    if workers == 1:
        layouts = [plan_shot(video_path, a, b, size, seats, force) for a, b in shots]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            layouts = list(pool.map(
                lambda shot: plan_shot(video_path, shot[0], shot[1], size, seats, force),
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
                   layout=Layout(kind="split", top=layout.bottom, bottom=layout.top,
                                 person=layout.person))


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
