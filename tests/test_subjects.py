"""Test សម្រាប់ pipeline/subjects.py.

យើងមិនផ្ទុក model ពិតទេ (35MB, យឺត) — យើងដាក់ network ក្លែងក្លាយដែលត្រឡប់
tensor ដែលយើងសរសេរដោយដៃ រួចពិនិត្យថាការ decode (grid × stride) និង NMS ត្រឹមត្រូវ។
"""

import math

import numpy as np
import pytest

import config
from pipeline import subjects as S

SIZE = (1280, 720)


class FakeNet:
    """cv2.dnn.Net ក្លែងក្លាយ — `forward()` ត្រឡប់អ្វីដែលយើងដាក់ឲ្យ."""

    def __init__(self, predictions):
        self.predictions = predictions

    def setInput(self, blob):
        pass

    def forward(self):
        return self.predictions


def prediction_with(anchor: int, centre: tuple[float, float], box: tuple[float, float],
                    stride: int, label: int = 0, score: float = 0.9):
    """Tensor (1, 8400, 85) ដែលមានវត្ថុតែមួយនៅ anchor នោះ."""
    predictions = np.zeros((1, 8400, 85), dtype=np.float32)
    predictions[0, anchor, 0:2] = centre
    predictions[0, anchor, 2] = math.log(box[0] / stride)
    predictions[0, anchor, 3] = math.log(box[1] / stride)
    predictions[0, anchor, 4] = score           # objectness
    predictions[0, anchor, 5 + label] = score   # class
    return predictions


def test_subject_properties():
    subject = S.Subject(x=100, y=50, w=60, h=80, label="person", score=0.9)
    assert (subject.cx, subject.cy) == (130, 90)
    assert subject.area == 4800
    assert subject.is_person and not subject.is_animal
    assert S.Subject(x=0, y=0, w=1, h=1, label="zebra", score=0.9).is_animal


def test_no_frame_means_no_subjects():
    assert S.detect_subjects_in_frame(None, SIZE) == []


def test_decoding_turns_grid_units_into_pixels(monkeypatch):
    """YOLOX ជា anchor-free: box = (តម្លៃ + grid) × stride, រួចថយ letterbox វិញ."""
    anchor = 40 * 80 + 40                       # stride 8, grid (40, 40)
    monkeypatch.setattr(S, "_net", lambda: FakeNet(
        prediction_with(anchor, (0.5, 0.5), (80.0, 160.0), stride=8)))

    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    found = S.detect_subjects_in_frame(frame, SIZE)
    assert len(found) == 1
    subject = found[0]
    # letterbox scale = 640/1280 = 0.5 -> ទំហំក្នុងរូបដើមទ្វេដង
    assert subject.label == "person"
    assert subject.w == pytest.approx(160, abs=2)
    assert subject.h == pytest.approx(320, abs=2)
    assert subject.cx == pytest.approx((40.5 * 8) / 0.5, abs=3)


def test_low_score_is_dropped(monkeypatch):
    anchor = 40 * 80 + 40
    monkeypatch.setattr(S, "_net", lambda: FakeNet(
        prediction_with(anchor, (0.5, 0.5), (80.0, 160.0), stride=8, score=0.3)))
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    assert S.detect_subjects_in_frame(frame, SIZE) == []


def test_only_people_and_animals_are_kept(monkeypatch):
    """COCO មាន 80 class — យើងយកតែមនុស្ស និងសត្វ (laptop មិនមែន subject)."""
    laptop = S.COCO_CLASSES.index("laptop")
    anchor = 40 * 80 + 40
    monkeypatch.setattr(S, "_net", lambda: FakeNet(
        prediction_with(anchor, (0.5, 0.5), (80.0, 160.0), stride=8, label=laptop)))
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    assert S.detect_subjects_in_frame(frame, SIZE) == []


def test_overlapping_boxes_are_merged(monkeypatch):
    """YOLOX ឲ្យ box ច្រើនលើវត្ថុតែមួយ -> NMS ត្រូវសល់តែមួយ."""
    predictions = prediction_with(40 * 80 + 40, (0.5, 0.5), (80.0, 160.0), stride=8)
    for offset in (1, 2, 81):
        other = prediction_with(40 * 80 + 40 + offset, (0.5, 0.5), (80.0, 160.0), stride=8)
        predictions = np.maximum(predictions, other)
    monkeypatch.setattr(S, "_net", lambda: FakeNet(predictions))
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    assert len(S.detect_subjects_in_frame(frame, SIZE)) == 1


def test_biggest_subject_comes_first(monkeypatch):
    small = prediction_with(10 * 80 + 10, (0.5, 0.5), (40.0, 40.0), stride=8)
    big = prediction_with(60 * 80 + 60, (0.5, 0.5), (200.0, 300.0), stride=8)
    monkeypatch.setattr(S, "_net", lambda: FakeNet(np.maximum(small, big)))
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    found = S.detect_subjects_in_frame(frame, SIZE)
    assert len(found) == 2
    assert found[0].area > found[1].area


# ---------- ចលនា ----------

def moving_square(frames: int, step: int, size=(720, 1280)):
    """រូបខ្មៅដែលមានការ៉េសដែលរំកិលទៅស្តាំ — ចលនាច្បាស់នៅកន្លែងតែមួយ."""
    made = []
    for index in range(frames):
        frame = np.zeros((*size, 3), dtype=np.uint8)
        x = 200 + index * step
        frame[300:400, x:x + 100] = 255
        made.append(frame)
    return made


def test_motion_finds_the_moving_thing(monkeypatch):
    frames = moving_square(6, step=40)
    monkeypatch.setattr(S, "grab_frame",
                        lambda path, t, size: frames[min(int(t), len(frames) - 1)])
    centre = S.motion_centre(None, 0.0, 6.0, (1280, 720))
    assert centre is not None
    cx, cy = centre
    assert 200 < cx < 800          # ការ៉េរំកិលក្នុងដែននេះ
    assert 280 < cy < 420


def test_a_still_shot_has_no_motion(monkeypatch):
    frame = np.zeros((720, 1280, 3), dtype=np.uint8)
    frame[300:400, 200:300] = 255
    monkeypatch.setattr(S, "grab_frame", lambda path, t, size: frame)
    assert S.motion_centre(None, 0.0, 6.0, (1280, 720)) is None


def test_a_camera_pan_is_rejected(monkeypatch):
    """កាមេរ៉ាបង្វិល -> រូបទាំងមូលរំកិល -> ចលនាស្មើពេញរូប -> គ្មានចម្លើយដែលមានន័យ.

    វាស់ពីភាពស្មើគ្នានៃផែនទីចលនា (mean/max): pan សង្រែះ 0.90,
    សត្វផ្លាស់ទីពិត 0.21-0.32។
    """
    base = np.zeros((720, 1280, 3), dtype=np.uint8)
    for column in range(0, 1280, 40):
        base[:, column:column + 20] = 200
    frames = [np.roll(base, step * 25, axis=1) for step in range(6)]
    monkeypatch.setattr(S, "grab_frame",
                        lambda path, t, size: frames[min(int(t), len(frames) - 1)])
    assert S.motion_centre(None, 0.0, 6.0, (1280, 720)) is None


def test_motion_needs_two_frames(monkeypatch):
    monkeypatch.setattr(S, "grab_frame", lambda path, t, size: None)
    assert S.motion_centre(None, 0.0, 6.0, (1280, 720)) is None
