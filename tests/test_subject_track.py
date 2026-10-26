"""Manual subject tracking: ការជ្រើសប្រធានបទ, ផ្លូវក្នុង shot, ការ shift តាម cuts."""
import pytest

import config
from pipeline import subject_track as st
from pipeline.reframe import manual_box, plan_shot
from pipeline.subjects import Subject


@pytest.fixture(autouse=True)
def nine_sixteen(monkeypatch):
    config.apply_aspect("9:16")
    monkeypatch.setattr(config, "SUBJECT_TRACKS", [])


def test_pick_takes_the_smallest_box_under_the_click(monkeypatch):
    found = [Subject(100, 100, 600, 500, "cow", 0.9), Subject(300, 300, 150, 120, "sheep", 0.8)]
    monkeypatch.setattr("pipeline.subjects.detect_subjects_in_frame", lambda frame, size: found)
    assert st.pick_subject(None, (1280, 720), 350, 350) == ((300, 300, 150, 120), "sheep")   # កូននៅមុខមេ
    assert st.pick_subject(None, (1280, 720), 200, 150) == ((100, 100, 600, 500), "cow")


def test_pick_falls_back_to_an_area_around_the_click(monkeypatch):
    monkeypatch.setattr("pipeline.subjects.detect_subjects_in_frame", lambda frame, size: [])
    box, label = st.pick_subject(None, (1280, 720), 1270, 10)
    assert label == "area" and box == (1100, 0, 180, 180)          # ការ៉េ 25% កម្ពស់, នៅក្នុងរូប


def track(points, start=10.0, end=20.0):
    return st.Track(start=start, end=end, box=(0, 0, 100, 100), label="cow", points=points,
                    good_from=points[0][0], good_until=points[-1][0])


def test_manual_box_follows_the_path_relative_to_the_shot():
    path = track([(10.0 + i, 300.0 + 60 * i, 360.0) for i in range(10)])
    box = manual_box(path, 10.0, 20.0, (1280, 720))
    assert box.x_expr and box.w == 404                              # 720 x 9/16 -> លេខគូ
    assert box.x_expr.startswith("if(lt(t,")                        # ពេលធៀបនឹងដើម shot (0)
    still = manual_box(track([(12.0, 640.0, 360.0)]), 10.0, 20.0, (1280, 720))
    assert still.x_expr is None and abs(still.x + still.w / 2 - 640) <= 2


def test_a_manual_track_wins_over_the_planner(monkeypatch):
    config.SUBJECT_TRACKS = [track([(10.0 + i, 300.0 + 60 * i, 360.0) for i in range(10)])]
    monkeypatch.setattr("pipeline.reframe.grab_frame", lambda *a: pytest.fail("AI មិនត្រូវមើល frame ទេ"))
    layout = plan_shot("v.mp4", 10.0, 20.0, (1280, 720))
    assert layout.kind == "single" and layout.box.x_expr
    assert st.tracks_for_shot(20.0, 25.0) is None                   # shot ផ្សេង = AI ធម្មតា


def test_shift_track_drops_cut_points_and_moves_the_rest():
    path = track([(10.0, 100.0, 0.0), (12.0, 200.0, 0.0), (16.0, 300.0, 0.0)])
    keeps = [(0.0, 11.0), (15.0, 30.0)]                             # 11-15 ត្រូវបានកាត់
    parts = st.shift_track(path, keeps)
    assert [(p.start, p.end) for p in parts] == [(10.0, 11.0), (11.0, 16.0)]
    assert parts[0].points == [(10.0, 100.0, 0.0)] and parts[1].points == [(12.0, 300.0, 0.0)]


def test_track_round_trips_through_json():
    path = track([(10.0, 100.0, 50.0), (11.0, 120.0, 55.0)])
    assert st.Track.from_dict(path.as_dict()) == path


class FakeTracker:
    """ViT ក្លែង: ប្រអប់ និង score តាមបញ្ជី (frame នីមួយៗ)."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.score = 1.0

    def init(self, frame, box):
        pass

    def update(self, frame):
        box, self.score = self.steps.pop(0)
        return True, box

    def getTrackingScore(self):
        return self.score


def follow(monkeypatch, steps):
    import numpy as np
    monkeypatch.setattr(st, "tracker_name", lambda: "vit")
    monkeypatch.setattr(st, "_make_tracker", lambda: FakeTracker(steps))
    frames = [np.zeros((360, 640, 3), np.uint8)] * (len(steps) + 1)
    return st._follow(frames, (100, 100, 90, 90), None)


def test_one_low_score_is_not_lost_but_three_in_a_row_are(monkeypatch):
    box = (100, 100, 90, 90)
    dip = [(box, 0.5), (box, 0.2), (box, 0.5), (box, 0.5)]           # ចានបាយ: ធ្លាក់មួយភ្លែត
    assert len(follow(monkeypatch, dip)) == 5
    lost = [(box, 0.5), (box, 0.2), (box, 0.1), (box, 0.2), (box, 0.5)]
    assert len(follow(monkeypatch, lost)) == 2                       # ចប់នៅចំណុចល្អចុងក្រោយ


def test_a_box_that_covers_the_frame_is_lost_but_growing_is_fine(monkeypatch):
    growing = [((100, 100, 200, 60), 0.4), ((80, 90, 400, 100), 0.4)]  # មកជិតកាមេរ៉ា
    assert len(follow(monkeypatch, growing)) == 3
    spread = [((100, 100, 200, 60), 0.4), ((0, 0, 600, 350), 0.7)]    # ឈុតរមាស: score ខ្ពស់ តែពេញ frame
    assert len(follow(monkeypatch, spread)) == 2
