"""អ្នកនិយាយនៅផ្ទាំងលើ (`--speaker-top`): ច្បាប់ឯករាជ្យពី video."""

from types import SimpleNamespace

import pytest

from pipeline import speakers as S
from pipeline.reframe import Box, Layout, Segment

LEFT = Box(100, 0, 400, 360)
RIGHT = Box(700, 0, 400, 360)


def split_segment(start=10.0, end=14.5) -> Segment:
    return Segment(start=start, end=end,
                   layout=Layout(kind="split", panels=[LEFT, RIGHT], box=Box(0, 0, 10, 10)))


def test_short_jump_is_removed():
    # talk_1 ដែលអ្នកអភិវឌ្ឍន៍ថាខុស: ស៊ុមចាប់អ្នកបរិភោគ និងសើចតែ 1 វិនាទី
    assert S.hold_runs([0, 0, 0, 0, 0, 1, 0, 0, 0], min_sec=2) == [0] * 9


def test_real_switch_is_kept():
    # shot 5 ដែលអ្នកអភិវឌ្ឍន៍ថាត្រូវ
    assert S.hold_runs([1, 1, 0, 0], min_sec=2) == [1, 1, 0, 0]


def test_quiet_seconds_keep_the_last_speaker():
    assert S.hold_runs([None, 0, 0, None, 1, 1], min_sec=2) == [0, 0, 0, 0, 1, 1]


def test_no_evidence_gives_none():
    assert S.hold_runs([None, None], min_sec=2) is None


def test_short_first_run_joins_the_next():
    assert S.hold_runs([1, 0, 0, 0], min_sec=2) == [0, 0, 0, 0]


def test_runs_merge_after_a_jump_is_removed():
    assert S.hold_runs([0, 0, 1, 0, 0, 1, 1], min_sec=2) == [0, 0, 0, 0, 0, 1, 1]


def test_face_belongs_to_the_panel_holding_it():
    assert S.panel_of(300, [LEFT, RIGHT]) == 0
    assert S.panel_of(900, [LEFT, RIGHT]) == 1
    assert S.panel_of(600, [LEFT, RIGHT]) is None    # អ្នកទីបី នៅក្រៅផ្ទាំងទាំងពីរ


def test_two_faces_need_speech():
    words = [SimpleNamespace(start=10.0, end=11.0)]
    assert S.pick_per_second([[1.0, 3.0], [5.0, 1.0]], 10.0, words) == [1, None]


def test_panel_without_a_face_is_never_picked():
    words = [SimpleNamespace(start=10.0, end=13.0)]
    nan = float("nan")
    assert S.pick_per_second([[nan, 3.0], [nan, nan]], 10.0, words) == [1, None]


def test_clip_3_keeps_the_visible_speaker_on_top():
    # លេខពិត 2500.2-2506.9 s: បុរសឃើញតែ 2 វិនាទី ហើយមួយភ្លែតឈ្នះនៅវិនាទីដំបូង
    nan = float("nan")
    scores = [[-2.35, -0.52], [0.22, nan], [1.77, nan], [-0.32, nan],
              [3.04, nan], [2.7, -13.22], [4.69, nan]]
    words = [SimpleNamespace(start=2500.0, end=2507.0)]
    assert S.hold_runs(S.pick_per_second(scores, 2500.2, words), min_sec=2) == [0] * 7


def test_speaker_goes_on_top_and_shot_is_cut_at_the_switch():
    pieces = S.speaker_segments(split_segment(), [1, 1, 0, 0])
    assert [(p.start, p.end) for p in pieces] == [(10.0, 12.0), (12.0, 14.5)]
    assert pieces[0].layout.panels == [RIGHT, LEFT]
    assert pieces[1].layout.panels == [LEFT, RIGHT]
    assert all(p.layout.kind == "split" for p in pieces)


def test_cut_moves_to_the_gap_between_words():
    words = [SimpleNamespace(start=11.0, end=11.8), SimpleNamespace(start=12.2, end=13.0)]
    pieces = S.speaker_segments(split_segment(), [1, 1, 0, 0], words)
    assert pieces[0].end == pytest.approx(12.0)
    words = [SimpleNamespace(start=11.5, end=12.1), SimpleNamespace(start=12.3, end=13.0)]
    pieces = S.speaker_segments(split_segment(), [1, 1, 0, 0], words)
    assert pieces[0].end == pytest.approx(12.2) and pieces[1].start == pytest.approx(12.2)


def test_cut_stays_when_no_gap_is_near():
    words = [SimpleNamespace(start=10.0, end=11.0), SimpleNamespace(start=11.1, end=14.0)]
    assert S.snap_to_gap(12.0, words, reach=0.5) == 12.0


def test_panel_mostly_without_a_face_is_found():
    nan = float("nan")
    # លេខពិត clip 3: បុរស 2 ក្នុង 7 វិនាទី
    scores = [[-2.35, -0.52], [0.22, nan], [1.77, nan], [-0.32, nan],
              [3.04, nan], [2.7, -13.22], [4.69, nan]]
    assert S.only_visible_panel(scores) == 0
    assert S.only_visible_panel([[1.0, 2.0]] * 4) is None        # ឃើញទាំងពីរ
    assert S.only_visible_panel([[nan, nan]] * 4) is None        # មិនឃើញទាំងពីរ


def test_person_out_of_frame_turns_the_shot_into_single(monkeypatch):
    nan = float("nan")
    monkeypatch.setattr(S, "mouth_scores", lambda *a: [[1.0, nan]] * 4)
    monkeypatch.setattr(S, "detect_faces", lambda *a: [SimpleNamespace(cx=300, w=100)])
    monkeypatch.setattr(S, "tracked_box", lambda *a: Box(1, 2, 3, 4))
    words = [SimpleNamespace(start=10.0, end=14.0)]
    [piece] = S.place_speakers("v.mp4", [split_segment()], (1280, 720), words)
    assert piece.layout.kind == "single"
    assert piece.layout.box == Box(1, 2, 3, 4)
    assert (piece.start, piece.end) == (10.0, 14.5)


def test_only_split_is_touched(monkeypatch):
    single = Segment(0.0, 5.0, Layout(kind="single", box=LEFT))
    def explode(*args):
        raise AssertionError("single មិនត្រូវវិភាគមាត់")
    monkeypatch.setattr(S, "mouth_scores", explode)
    assert S.place_speakers("v.mp4", [single], (1280, 720), []) == [single]


def test_shot_without_evidence_keeps_its_order(monkeypatch):
    monkeypatch.setattr(S, "mouth_scores", lambda *a: [[1.0, 2.0]] * 4)
    shot = split_segment()
    assert S.place_speakers("v.mp4", [shot], (1280, 720), []) == [shot]   # គ្មានពាក្យ = គ្មានភស្តុតាង
