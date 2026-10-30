"""Cut list (Edit Video ជំហាន ២): normalize, keep, រំកិលពេល transcript, filtergraph, CLI."""
import json

import pytest
from typer.testing import CliRunner

import make_clips
from pipeline import cuts as C
from pipeline.transcribe import Segment, Transcript, Word


def test_normalize_sorts_clamps_merges_and_drops_tiny():
    raw = [(40, 50), (10, 20), (15, 25), (-3, 1), (54, 99), (30, 30.02)]
    assert C.normalize(raw, 55.75) == [(0.0, 1.0), (10.0, 25.0), (40.0, 50.0), (54.0, 55.75)]


def test_keep_ranges_is_the_complement_without_slivers():
    assert C.keep_ranges(55.75, [(12.4, 38.87)]) == [(0.0, 12.4), (38.87, 55.75)]
    # 0.05 s រវាងការកាត់ពីរ = ខ្លីពេក មិនរក្សាទុក
    assert C.keep_ranges(10.0, [(2.0, 4.0), (4.05, 6.0)]) == [(0.0, 2.0), (6.0, 10.0)]
    assert C.keep_ranges(10.0, [(0.0, 10.0)]) == []


def test_shift_time_maps_into_the_copy():
    keeps = [(0.0, 12.4), (38.87, 55.75)]
    assert C.shift_time(5.0, keeps) == 5.0
    assert C.shift_time(20.0, keeps) is None             # ត្រូវកាត់ចេញ
    assert C.shift_time(40.0, keeps) == round(12.4 + 1.13, 3)


def test_shift_transcript_drops_cut_words_and_shifts_the_rest():
    words = [Word(" On", 0.0, 0.3), Word(" John", 0.4, 0.8), Word(" dead", 13.0, 13.5),
             Word(" still", 38.8, 39.2), Word(" That's", 40.0, 40.4)]
    transcript = Transcript(language="en", language_probability=0.9, duration=55.75, model="m", device="cuda",
                            segments=[Segment(id=0, start=0.0, end=40.4, text="x", words=words)])
    keeps = [(0.0, 12.4), (38.87, 55.75)]
    shifted = C.shift_transcript(transcript, keeps)
    texts = [w.word for w in shifted.segments[0].words]
    assert texts == [" On", " John", " still", " That's"]   # "dead" (13.0) ត្រូវកាត់
    still = shifted.segments[0].words[2]
    assert still.start == 12.4 and still.end == round(12.4 + 0.33, 3)   # គែម keep ត្រូវកាត់ឲ្យនៅក្នុង
    assert shifted.segments[0].words[3].start == round(12.4 + 1.13, 3)
    assert shifted.duration == round(12.4 + 16.88, 3)


def test_cut_filter_punch_zooms_every_other_part_and_fades_audio():
    graph = C.cut_filter([(0.0, 12.4), (38.87, 55.75), (60.0, 70.0)], "punch", 1280, 720, audio=True)
    assert "split=3" in graph and "asplit=3" in graph
    assert graph.count("crop=1162:654") == 1               # តែផ្នែកទី ២ (1280/1.1, 720/1.1 គូ)
    assert "[sv1]trim=start=38.870000:end=55.750000,setpts=PTS-STARTPTS,crop=" in graph
    assert graph.count("afade=t=in") == 3 and graph.endswith("concat=n=3:v=1:a=1[v][a]")
    hard = C.cut_filter([(0.0, 5.0), (8.0, 9.0)], "hard", 1280, 720, audio=False)
    assert "crop" not in hard and "atrim" not in hard and hard.endswith("concat=n=2:v=1:a=0[v]")


def test_read_cut_list_accepts_both_shapes(tmp_path):
    a = tmp_path / "a.json"
    a.write_text(json.dumps({"cuts": [[1, 2], [3.5, 4]]}))
    b = tmp_path / "b.json"
    b.write_text(json.dumps([{"start": 1, "end": 2}]))
    assert C.read_cut_list(a) == [(1.0, 2.0), (3.5, 4.0)]
    assert C.read_cut_list(b) == [(1.0, 2.0)]
    assert C.edit_folder("9:16") == "full_edit" and C.edit_folder("16:9") == "full_edit_16x9"


def test_cli_refuses_cuts_without_full_or_unknown_transition(tmp_path):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    cut_file = tmp_path / "c.json"
    cut_file.write_text('{"cuts": [[1, 2]]}')
    runner = CliRunner()
    assert runner.invoke(make_clips.app, [str(video), "--cuts", str(cut_file)]).exit_code == 2
    result = runner.invoke(make_clips.app, [str(video), "--full", "--cuts", str(cut_file), "--transition", "wipe"])
    assert result.exit_code == 2


def test_cut_video_reuses_a_copy_made_with_the_same_settings(tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"source")
    out = tmp_path / "edit" / "source.mp4"
    calls = []
    monkeypatch.setattr(C, "has_audio", lambda path: True)
    from pipeline import render
    monkeypatch.setattr(render, "encoder_args", lambda: ("x264", ["-c:v", "libx264", "-crf", "20"]))

    def fake_run(command, **kwargs):
        calls.append(command)
        out.write_bytes(b"cut")
    monkeypatch.setattr(C.subprocess, "run", fake_run)
    C.cut_video(video, [(0.0, 1.0), (2.0, 10.0)], out, size=(1280, 720))
    C.cut_video(video, [(0.0, 1.0), (2.0, 10.0)], out, size=(1280, 720))       # cache
    C.cut_video(video, [(0.0, 1.0), (3.0, 10.0)], out, size=(1280, 720))       # cut list ថ្មី
    assert len(calls) == 2
    assert calls[0][calls[0].index("-crf") + 1] == "16"                            # គុណភាពខ្ពស់
    assert video.read_bytes() == b"source"                                       # ដើមមិនប៉ះ
    with pytest.raises(ValueError):
        C.cut_video(video, [], out, size=(1280, 720))


def test_snap_to_frames_moves_every_edge_up_to_a_frame():
    fps = 24000 / 1001
    snapped = C.snap_to_frames([(0.0, 12.96), (39.23, 40.65)], fps)
    for start, end in snapped:
        for edge in (start, end):
            assert abs(edge * fps - round(edge * fps)) < 1e-3     # ចំពេល frame
    assert snapped[0] == (0.0, round(311 / fps, 6))               # 12.96 s = frame 310.6 -> 311
    assert C.snap_to_frames([(1.0, 2.0)], None) == [(1.0, 2.0)]   # គ្មាន fps = មិនប្តូរ


# ---- inserts ("+ Extend a clip"): ផ្នែកដែលចម្លងទៅដាក់កន្លែងផ្សេង ----

def test_sequence_places_a_hook_before_everything():
    keeps = [(0.0, 30.0)]
    assert C.sequence(keeps, [(20.0, 25.0, 0.0)], 30.0) == [(20.0, 25.0), (0.0, 30.0)]
    assert C.sequence(keeps, [], 30.0) == keeps                        # គ្មាន insert = ដូចមុន


def test_sequence_splits_the_keep_at_the_playhead_and_handles_cuts_and_the_end():
    keeps = [(0.0, 10.0), (20.0, 30.0)]                                # 10-20 ត្រូវកាត់
    # at 5 (ក្នុង keep) -> keep បែកជាពីរ ហើយផ្នែកដែលបន្ថែមនៅកណ្តាល
    assert C.sequence(keeps, [(25.0, 27.0, 5.0)], 30.0) == [(0.0, 5.0), (25.0, 27.0), (5.0, 10.0), (20.0, 30.0)]
    # at 15 (ក្នុងការកាត់) -> មុន keep បន្ទាប់
    assert C.sequence(keeps, [(1.0, 2.0, 15.0)], 30.0) == [(0.0, 10.0), (1.0, 2.0), (20.0, 30.0)]
    # at ចុង -> ក្រោយគេ; inserts ដែល at ដូចគ្នា តាមលំដាប់ក្នុងបញ្ជី
    assert C.sequence(keeps, [(1.0, 2.0, 30.0), (3.0, 4.0, 30.0)], 30.0)[-2:] == [(1.0, 2.0), (3.0, 4.0)]
    # at ជិតគែម keep (តិចជាង 0.1 s) = មិនបំបែក (គ្មានបំណែកតូច)
    assert C.sequence(keeps, [(25.0, 27.0, 9.95)], 30.0) == [(0.0, 10.0), (25.0, 27.0), (20.0, 30.0)]
    # ផ្នែកខ្លីពេក ឬនៅក្រៅវីដេអូ = មិនយក
    assert C.sequence(keeps, [(5.0, 5.05, 0.0), (40.0, 50.0, 0.0)], 30.0) == keeps


def test_shift_range_and_time_with_a_repeated_part():
    parts = [(20.0, 25.0), (0.0, 30.0)]                                # hook 20-25 រួចវីដេអូទាំងមូល
    assert C.shift_range((21.0, 22.0), parts) == [(1.0, 2.0), (26.0, 27.0)]   # លេចពីរដង
    assert C.shift_time(21.0, parts) == 1.0                            # កន្លែងដំបូង
    assert C.shift_time(2.0, parts) == 7.0


def test_shift_transcript_repeats_the_words_of_a_hook():
    words = [Word(" One", 1.0, 1.5), Word(" two", 21.0, 21.5), Word(" three", 28.0, 28.5)]
    transcript = Transcript(language="en", language_probability=0.9, duration=30.0, model="m", device="cuda",
                            segments=[Segment(id=0, start=1.0, end=28.5, text="x", words=words)])
    shifted = C.shift_transcript(transcript, [(20.0, 25.0), (0.0, 30.0)])
    flat = [(w.word, w.start) for s in shifted.segments for w in s.words]
    assert flat == [(" two", 1.0), (" One", 6.0), (" two", 26.0), (" three", 33.0)]
    assert shifted.duration == 35.0
    # hook មួយ segment, រួចវីដេអូទាំងមូលជា segment មួយ (បន្តតាមពេល)
    assert [s.text for s in shifted.segments] == ["two", "One two three"]


def test_cut_filter_trims_parts_in_output_order():
    graph = C.cut_filter([(20.0, 25.0), (0.0, 30.0)], "hard", 1280, 720, audio=True)
    assert graph.index("[sv0]trim=start=20.000000") < graph.index("[sv1]trim=start=0.000000")


# ---- order: ប្លុកដែលអូសប្តូរលំដាប់លើ timeline ----

def test_rearrange_swaps_blocks_and_an_unchanged_order_changes_nothing():
    keeps = [(0.0, 30.0)]
    assert C.rearrange(keeps, [(10.0, 30.0), (0.0, 10.0)]) == [(10.0, 30.0), (0.0, 10.0)]
    assert C.rearrange(keeps, [(0.0, 10.0), (10.0, 30.0)]) == keeps    # split តែមិនប្តូរ = គ្មានកន្លែងភ្ជាប់ថ្មី
    assert C.rearrange(keeps, []) == keeps


def test_rearrange_respects_cuts_and_never_loses_a_part():
    keeps = [(0.0, 10.0), (20.0, 30.0)]                                # 10-20 ត្រូវកាត់
    # ប្លុក 0-25 មានការកាត់នៅកណ្តាល: ផ្នែកដែលកាត់មិនត្រឡប់មកវិញទេ
    assert C.rearrange(keeps, [(25.0, 30.0), (0.0, 25.0)]) == [(25.0, 30.0), (0.0, 10.0), (20.0, 25.0)]
    # ផ្នែកដែល order មិននិយាយដល់ ទៅនៅចុង
    assert C.rearrange(keeps, [(20.0, 30.0)]) == [(20.0, 30.0), (0.0, 10.0)]


def test_sequence_keeps_an_insert_with_its_piece_after_a_rearrange():
    moved = [(15.0, 30.0), (0.0, 15.0)]
    # at 15 = មុនប្លុក 15-30 ដែលឥឡូវនៅមុនគេ (មិនមែនតាមទីតាំងចេញ)
    assert C.sequence(moved, [(1.0, 2.0, 15.0)], 30.0) == [(1.0, 2.0), (15.0, 30.0), (0.0, 15.0)]
    # at 20 បំបែកប្លុកដែលផ្លាស់ទី; insert នៅកណ្តាលវា
    assert C.sequence(moved, [(1.0, 2.0, 20.0)], 30.0) == [(15.0, 20.0), (1.0, 2.0), (20.0, 30.0), (0.0, 15.0)]


def test_shift_transcript_follows_the_new_order():
    words = [Word(" One", 1.0, 1.5), Word(" two", 21.0, 21.5)]
    transcript = Transcript(language="en", language_probability=0.9, duration=30.0, model="m", device="cuda",
                            segments=[Segment(id=0, start=1.0, end=21.5, text="x", words=words)])
    shifted = C.shift_transcript(transcript, [(10.0, 30.0), (0.0, 10.0)])
    assert [(w.word, w.start) for s in shifted.segments for w in s.words] == [(" two", 11.0), (" One", 21.0)]


def test_read_order_is_empty_without_the_key(tmp_path):
    a = tmp_path / "a.json"
    a.write_text(json.dumps({"cuts": [], "order": [[10, 30], [0, 10]]}))
    assert C.read_order(a) == [(10.0, 30.0), (0.0, 10.0)]
    b = tmp_path / "b.json"
    b.write_text(json.dumps({"cuts": [[1, 2]]}))
    assert C.read_order(b) == []


def test_read_inserts_accepts_both_shapes_and_cut_lists_without_them(tmp_path):
    a = tmp_path / "a.json"
    a.write_text(json.dumps({"cuts": [], "inserts": [{"start": 136.46, "end": 300.7, "at": 0}, [1, 2, 3]]}))
    assert C.read_inserts(a) == [(136.46, 300.7, 0.0), (1.0, 2.0, 3.0)]
    b = tmp_path / "b.json"
    b.write_text(json.dumps({"cuts": [[1, 2]]}))
    assert C.read_inserts(b) == []
