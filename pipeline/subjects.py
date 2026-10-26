"""រក **subject** ក្នុង frame — មនុស្ស និងសត្វ — មិនត្រឹមតែមុខទេ.

**ហេតុអ្វីត្រូវមាន module នេះ?** Face detector គ្របដណ្តប់ podcast បានល្អ (100% នៃ
frame គំរូ) តែលើវីដេអូសត្វព្រៃវាឃើញមុខត្រឹម **47%** — ពាក់កណ្តាលនៃវីដេអូគ្មានសញ្ញា
អ្វីសោះ ហើយយើងធ្លាក់ទៅ center crop។ OpusClip លើ footage ដដែលតាម **រូបកាយ**
មនុស្ស ទោះមុខមិនឃើញ។

Model: YOLOX-S (COCO, 80 class) ពី opencv_zoo ដូចប្រភព YuNet/SFace ដែរ។ វាជា
**anchor-free** ដូច្នេះការ decode សាមញ្ញ: box = (ទីតាំងក្នុង grid + grid) × stride។
"""

import threading
from dataclasses import dataclass
from pathlib import Path

import config
from pipeline.reframe import ReframeError, grab_frame

# COCO 80 class តាមលំដាប់ដើម (យើងត្រូវការឈ្មោះដើម្បីច្រោះ)
COCO_CLASSES = (
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
    "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
    "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
    "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
    "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
    "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
    "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
    "hair drier", "toothbrush",
)
ANIMALS = frozenset({"bird", "cat", "dog", "horse", "sheep", "cow", "elephant",
                     "bear", "zebra", "giraffe"})


@dataclass
class Subject:
    """វត្ថុមួយដែលចាប់បាន (pixel ក្នុងរូបដើម)."""

    x: int
    y: int
    w: int
    h: int
    label: str
    score: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def area(self) -> int:
        return self.w * self.h

    @property
    def is_person(self) -> bool:
        return self.label == "person"

    @property
    def is_animal(self) -> bool:
        return self.label in ANIMALS


_state = threading.local()


def _net():
    """ផ្ទុក YOLOX ម្តងក្នុងមួយ thread (cv2.dnn.Net មិនមែន thread-safe)."""
    existing = getattr(_state, "net", None)
    if existing is not None:
        return existing

    import cv2

    model = Path(config.SUBJECT_MODEL_PATH)
    if not model.is_file():
        raise ReframeError(
            f"គ្មាន subject model នៅ {model}។ Download:\n"
            f"  curl -L -o {model} {config.SUBJECT_MODEL_URL}"
        )
    net = cv2.dnn.readNet(str(model))
    _state.net = net
    return net


def _grid_and_stride(size: int):
    """ចំណុច grid និង stride សម្រាប់ YOLOX (stride 8/16/32) — គណនាម្តងរក្សាទុក."""
    import numpy as np

    cache = getattr(_state, "grids", None)
    if cache is None:
        cache = _state.grids = {}
    if size in cache:
        return cache[size]

    grids, strides = [], []
    for stride in (8, 16, 32):
        side = size // stride
        xv, yv = np.meshgrid(np.arange(side), np.arange(side))
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
        strides.append(np.full((side * side, 1), stride))
    cache[size] = (np.concatenate(grids, 0), np.concatenate(strides, 0))
    return cache[size]


def detect_subjects_in_frame(frame, size: tuple[int, int],
                             min_score: float | None = None) -> list[Subject]:
    """រាយមនុស្ស និងសត្វក្នុង frame មួយ (ធំជាងគេមុន)."""
    if frame is None:
        return []

    import cv2
    import numpy as np

    min_score = config.SUBJECT_MIN_SCORE if min_score is None else min_score
    side = config.SUBJECT_INPUT
    frame_w, frame_h = size

    # letterbox: រក្សាសមាមាត្រ រួចបំពេញ 114 ដូច YOLOX ដើម
    scale = min(side / frame_w, side / frame_h)
    new_w, new_h = int(frame_w * scale), int(frame_h * scale)
    canvas = np.full((side, side, 3), 114, dtype=np.uint8)
    canvas[:new_h, :new_w] = cv2.resize(frame, (new_w, new_h))

    net = _net()
    net.setInput(cv2.dnn.blobFromImage(canvas))
    predictions = net.forward()
    predictions = predictions[0] if predictions.ndim == 3 else predictions

    grid, stride = _grid_and_stride(side)
    boxes = predictions[:, :4].copy()
    boxes[:, :2] = (boxes[:, :2] + grid) * stride          # កណ្តាល
    boxes[:, 2:4] = np.exp(boxes[:, 2:4]) * stride         # ទំហំ
    scores = predictions[:, 4:5] * predictions[:, 5:]
    labels = scores.argmax(1)
    best = scores.max(1)

    keep = best >= min_score
    if not keep.any():
        return []

    # NMS ដើម្បីដក box ជាន់គ្នា (YOLOX ឲ្យច្រើន box ក្នុងវត្ថុតែមួយ)
    xywh = []
    for cx, cy, w, h in boxes[keep]:
        xywh.append([int((cx - w / 2) / scale), int((cy - h / 2) / scale),
                     int(w / scale), int(h / scale)])
    chosen = cv2.dnn.NMSBoxes(xywh, best[keep].tolist(), min_score, 0.45)

    subjects = []
    kept_labels = labels[keep]
    kept_scores = best[keep]
    for index in np.array(chosen).flatten():
        name = COCO_CLASSES[kept_labels[index]]
        if name != "person" and name not in ANIMALS:
            continue
        x, y, w, h = xywh[index]
        subjects.append(Subject(
            x=max(0, x), y=max(0, y),
            w=min(w, frame_w), h=min(h, frame_h),
            label=name, score=round(float(kept_scores[index]), 3),
        ))
    return sorted(subjects, key=lambda s: s.area, reverse=True)


def detect_subjects(video_path: Path, timestamp: float,
                    size: tuple[int, int]) -> list[Subject]:
    return detect_subjects_in_frame(grab_frame(video_path, timestamp, size), size)


# ---------- ចលនា (ពេលគ្មានមុខ គ្មានវត្ថុ) ----------

def motion_centre(video_path: Path, start: float, end: float, size: tuple[int, int],
                  samples: int | None = None) -> tuple[float, float] | None:
    """(cx, cy) នៃតំបន់ដែលមានចលនាច្រើនបំផុតក្នុង shot — ឬ `None`.

    **ហេតុអ្វីត្រូវការ?** ក្នុងវីដេអូសត្វព្រៃ ២០% នៃ frame គ្មានទាំងមុខទាំងវត្ថុ
    ដែលស្គាល់បាន (ធូលី, ចលនាព្រិលពេលរមាសរត់)។ តែ **ចលនា** ប្រាប់យើងបានថា
    គួរមើលទីណា។

    របៀប: យក frame តូចៗ រួចដក frame ជាប់គ្នា (frame differencing) បូកបញ្ចូលគ្នា
    ជាផែនទីចលនា រួចយកចំណុចកណ្តាលទម្ងន់នៃកន្លែងដែលចលនាខ្លាំងជាងធម្មតា។
    """
    import cv2
    import numpy as np

    samples = config.MOTION_SAMPLES if samples is None else samples
    frame_w, frame_h = size
    small_w = config.MOTION_WIDTH
    small_h = max(2, int(small_w * frame_h / frame_w))

    moments = [start + (end - start) * (i + 0.5) / samples for i in range(samples)]
    greys = []
    for moment in moments:
        frame = grab_frame(video_path, moment, size)
        if frame is None:
            continue
        small = cv2.resize(frame, (small_w, small_h), interpolation=cv2.INTER_AREA)
        greys.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.int16))

    if len(greys) < 2:
        return None

    motion = np.zeros((small_h, small_w), dtype=np.float32)
    for before, after in zip(greys, greys[1:]):
        motion += np.abs(after - before)

    # ចលនាទូទាំងរូប (camera pan) ផ្តល់តម្លៃស្មើៗគ្នា -> កណ្តាលទម្ងន់ជិតកណ្តាលរូប
    # ដែលជាចម្លើយសុវត្ថិភាពរួចទៅហើយ។ យើងយកតែកន្លែងដែលលើសមធ្យម + 1 SD។
    threshold = motion.mean() + motion.std()
    hot = motion >= max(threshold, 1.0)
    if hot.sum() < config.MOTION_MIN_PIXELS:
        return None
    peak = float(motion.max())
    if peak <= 0 or motion.mean() / peak > config.MOTION_MAX_UNIFORMITY:
        return None            # ចលនាស្មើពេញរូប = កាមេរ៉ាបង្វិល -> ចម្លើយគ្មានន័យ

    weights = motion * hot
    total = weights.sum()
    if total <= 0:
        return None
    ys, xs = np.nonzero(hot)
    cx = float((xs * weights[ys, xs]).sum() / total) * frame_w / small_w
    cy = float((ys * weights[ys, xs]).sum() / total) * frame_h / small_h
    return cx, cy


def motion_level(video_path: Path, start: float, end: float, size: tuple[int, int],
                 samples: int | None = None,
                 region: tuple[int, int] | None = None) -> float:
    """ចលនាមធ្យមក្នុង shot (0-255) — តូច = រូបស្ងៀម (slide, អេក្រង់).

    ផ្សេងពី `motion_centre()` ដែលប្រាប់ *ទីណា* — មួយនេះប្រាប់ *ប៉ុន្មាន*។
    វាស់លើ video ពិត: slide ក្នុង webinar 0.03-0.25, សត្វរត់ក្នុងធូលី 51-66។
    """
    import cv2
    import numpy as np

    samples = config.MOTION_SAMPLES if samples is None else samples
    frame_w, frame_h = size
    # `region` = ជួរ x0..x1 តែប៉ុណ្ណោះ (layout screen វាស់តែ slide មិនមែនមនុស្សក្នុង webcam)
    x0, x1 = region if region else (0, frame_w)
    frame_w = max(2, x1 - x0)
    small_w = config.MOTION_WIDTH
    small_h = max(2, int(small_w * frame_h / frame_w))

    greys = []
    for index in range(samples):
        moment = start + (end - start) * (index + 0.5) / samples
        frame = grab_frame(video_path, moment, size)
        if frame is None:
            continue
        small = cv2.resize(frame[:, x0:x1], (small_w, small_h), interpolation=cv2.INTER_AREA)
        greys.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.int16))

    if len(greys) < 2:
        return 0.0
    return float(np.mean([np.abs(b - a).mean() for a, b in zip(greys, greys[1:])]))
