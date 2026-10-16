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
