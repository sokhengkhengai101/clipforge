"""Test សម្រាប់ pipeline/captions.py.

គោលដៅសំខាន់៖ ធានាថា `.ass` ដែលចេញគោរពច្បាប់ (≤2 បន្ទាត់, ≤32 តួ), ពេលវេលារាប់ពី
ដើម clip, និងពណ៌ត្រូវបម្លែងទៅ BGR ត្រឹមត្រូវ។
"""

import re

import pytest

import config
from pipeline import captions as C
from pipeline.highlights import Clip
from pipeline.transcribe import Segment, Transcript, Word

BREAK = chr(92) + "N"      # `\N` ក្នុង ASS (សរសេរបែបនេះដើម្បីអានងាយ)


def make_words(spec: list[tuple[str, float, float]]) -> list[Word]:
    return [Word(word=w, start=s, end=e, probability=0.9) for w, s, e in spec]


def transcript_with(words: list[Word], duration: float = 100.0) -> Transcript:
    segment = Segment(id=0, start=words[0].start, end=words[-1].end,
                      text=" ".join(w.word for w in words), words=words)
    return Transcript(language="en", language_probability=1.0, duration=duration,
                      model="t", device="cpu", segments=[segment])


def sentence_words(start: float = 100.0, count: int = 20, step: float = 0.5) -> list[Word]:
    """ពាក្យ `word0 word1 ...` ចាប់ពី `start` (នៅកណ្តាល video)."""
    return make_words([(f"word{i}", start + i * step, start + (i + 1) * step)
                       for i in range(count)])


def dialogue_lines(ass_text: str) -> list[str]:
    return [l for l in ass_text.splitlines() if l.startswith("Dialogue:")]


def dialogue_text(line: str) -> str:
    """យកតែ field Text (field ទី 10) ហើយលុប override tag ចេញ."""
    text = line[len("Dialogue: "):].split(",", 9)[9]
    return re.sub("[{][^}]*[}]", "", text)


# ---------- ពណ៌ និងពេលវេលា ----------

def test_ass_color_is_bgr_not_rgb():
    """ASS ប្រើ BGR បញ្ច្រាស — នេះជាកន្លែងងាយខុសបំផុតក្នុង format នេះ."""
    assert C.ass_color("#FFD23F") == "&H003FD2FF"      # R=FF G=D2 B=3F
    assert C.ass_color("#FFFFFF") == "&H00FFFFFF"
    assert C.ass_color("#000000") == "&H00000000"
    assert C.ass_color("#FF0000") == "&H000000FF"      # ក្រហម -> B=00 G=00 R=FF


def test_ass_color_accepts_no_hash_and_alpha():
    assert C.ass_color("FFD23F") == "&H003FD2FF"
    assert C.ass_color("#FFD23F", alpha=0x80) == "&H803FD2FF"


def test_ass_color_rejects_bad_input():
    with pytest.raises(C.CaptionError):
        C.ass_color("#FFF")


@pytest.mark.parametrize("seconds,expected", [
    (0.0, "0:00:00.00"),
    (0.5, "0:00:00.50"),
    (125.34, "0:02:05.34"),
    (3661.0, "1:01:01.00"),
])
def test_ass_time(seconds, expected):
    assert C.ass_time(seconds) == expected


def test_ass_time_never_rounds_to_100_centiseconds():
    """1.999 មិនត្រូវក្លាយជា `.100` (ខុស format)."""
    assert C.ass_time(1.999).endswith(".99")


def test_ass_time_clamps_negative():
    assert C.ass_time(-5.0) == "0:00:00.00"


# ---------- escape ----------

def test_escape_ass_text_removes_syntax_characters():
    assert C.escape_ass_text("a {b} c") == "a (b) c"
    assert C.escape_ass_text("back" + chr(92) + "slash") == "back/slash"


# ---------- font ----------

def test_find_font_file_finds_installed_font():
    """Inter មានលើម៉ាស៊ីននេះ (Windows Fonts)."""
    assert C.find_font_file("Inter Bold") is not None


def test_find_font_file_returns_none_for_nonsense():
    assert C.find_font_file("ThisFontDoesNotExist12345") is None


def test_find_font_file_does_not_match_different_family():
    """MontserratSubrayada-Bold មានលើម៉ាស៊ីន តែវាមិនមែន Montserrat ExtraBold ទេ."""
    found = C.find_font_file("Montserrat ExtraBold")
    if found is not None:
        assert "subrayada" not in found.stem.lower()


def test_resolve_font_falls_back_and_reports_it():
    font, is_wanted = C.resolve_font("ThisFontDoesNotExist12345", ("Inter Bold",))
    assert font == "Inter Bold"
    assert is_wanted is False


def test_resolve_font_reports_success():
    font, is_wanted = C.resolve_font("Inter Bold", ())
    assert (font, is_wanted) == ("Inter Bold", True)


# ---------- wrap ----------

def test_wrap_respects_char_and_line_limits():
    words = sentence_words(count=40)
    cues = C.wrap_into_cues(words, clip_start=100.0, max_chars=20, max_lines=2)

    assert cues
    for cue in cues:
        assert len(cue.lines) <= 2
        for line in cue.lines:
            length = sum(len(w.word.strip()) for w in line) + len(line) - 1
            assert length <= 20


def test_wrap_times_are_relative_to_clip_start():
    """ពេលវេលាក្នុង .ass ត្រូវរាប់ពី 0 ព្រោះ render កាត់ clip ចេញ."""
    words = sentence_words(start=100.0, count=4, step=0.5)
    cues = C.wrap_into_cues(words, clip_start=100.0, max_chars=40, max_lines=2)
    assert cues[0].start == pytest.approx(0.0)
    assert cues[-1].end == pytest.approx(2.0)


def test_wrap_keeps_long_word_even_if_it_exceeds_limit():
    """ពាក្យវែងជាងដែន មិនអាចកាត់បាន -> ត្រូវដាក់វាទាំងមូល (មិនបាត់)."""
    words = make_words([("extraordinarily", 0.0, 1.0), ("long", 1.0, 2.0)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=5, max_lines=2)
    text = " ".join(cue.text() for cue in cues)
    assert "extraordinarily" in text


def test_wrap_handles_zero_duration_words():
    """Whisper ឲ្យ start == end -> cue ត្រូវមានរយៈពេលឃើញបាន (0.5s)."""
    words = make_words([("Yeah.", 10.0, 10.0)])
    cues = C.wrap_into_cues(words, clip_start=10.0)
    assert cues[0].end > cues[0].start


def test_wrap_cues_do_not_overlap():
    words = sentence_words(count=30)
    cues = C.wrap_into_cues(words, clip_start=100.0, max_chars=15, max_lines=1)
    for earlier, later in zip(cues, cues[1:]):
        assert earlier.end <= later.start


def test_wrap_skips_empty_words():
    words = make_words([("  ", 0.0, 0.5), ("real", 0.5, 1.0)])
    cues = C.wrap_into_cues(words, clip_start=0.0)
    assert cues[0].text() == "real"


# ---------- keywords ----------

def test_pick_keywords_prefers_long_content_words():
    """ពាក្យវែងបំផុតដែលមិនមែន stopword ឈ្នះ (default = ១ ក្នុងមួយ cue)."""
    words = make_words([("the", 0, 1), ("algorithm", 1, 2), ("is", 2, 3), ("broken", 3, 4)])
    cue = C.Cue(start=0, end=4, lines=[words])
    assert C.pick_keywords(cue) == {"algorithm"}
    assert C.pick_keywords(cue, max_keywords=2) == {"algorithm", "broken"}


def test_pick_keywords_skips_stopwords_and_short_words():
    words = make_words([("really", 0, 1), ("about", 1, 2), ("cat", 2, 3)])
    cue = C.Cue(start=0, end=3, lines=[words])
    assert C.pick_keywords(cue) == set()      # ទាំងអស់ជា stopword ឬខ្លីពេក


def test_highlight_applies_to_first_occurrence_only():
    """bug ពិត: "skills, skills, skills" ក្លាយលឿងទាំងអស់ -> ការបំលេចអស់អត្ថន័យ."""
    words = make_words([("skills,", 0, 1), ("skills,", 1, 2), ("skills", 2, 3)])
    cue = C.Cue(start=0, end=3, lines=[words])
    text = C.cue_to_dialogue_text(cue, {"skills"}, config.CAPTION_KEYWORD_COLOR)
    assert text.count(C.ass_color(config.CAPTION_KEYWORD_COLOR)) == 1


def test_highlight_tag_is_closed_with_ampersand():
    """ទម្រង់ត្រឹមត្រូវ: {\\c&HBBGGRR&} — `&` បិទតម្លៃពណ៌."""
    words = make_words([("algorithm", 0, 1)])
    cue = C.Cue(start=0, end=1, lines=[words])
    text = C.cue_to_dialogue_text(cue, {"algorithm"}, config.CAPTION_KEYWORD_COLOR)
    assert "&}" in text


def test_dialogue_text_uses_ass_line_break():
    words = sentence_words(count=10, step=0.2)
    cue = C.wrap_into_cues(words, clip_start=100.0, max_chars=12, max_lines=2)[0]
    text = C.cue_to_dialogue_text(cue, set(), config.CAPTION_KEYWORD_COLOR)
    assert BREAK in text
    assert "\n" not in text          # newline ពិតមិនត្រូវមានទេ


# ---------- build_ass ----------

def test_build_ass_structure(tmp_path):
    words = sentence_words(start=100.0, count=20)
    transcript = transcript_with(words)
    clip = Clip(start=100.0, end=110.0, title="x", score=8)

    path = C.build_ass(clip, transcript, tmp_path / "clip_01.ass", font="Inter Bold")
    text = path.read_text(encoding="utf-8")

    assert "[Script Info]" in text and "[V4+ Styles]" in text and "[Events]" in text
    assert f"PlayResX: {config.OUT_WIDTH}" in text
    assert f"PlayResY: {config.OUT_HEIGHT}" in text
    assert "Inter Bold" in text
    assert dialogue_lines(text)


def test_build_ass_respects_limits_on_real_shaped_text(tmp_path):
    """ច្បាប់ ≤2 បន្ទាត់ និង ≤32 តួ ត្រូវគោរពក្នុង file ពិត."""
    words = make_words([
        (w, i * 0.4, (i + 1) * 0.4) for i, w in enumerate(
            ("But", "here's", "the", "problem.", "A", "lot", "of", "people", "will",
             "identify", "a", "workflow", "and", "then", "jump", "straight", "to",
             "creating", "the", "skill", "right", "away.", "That", "is", "the", "worst",
             "thing", "you", "can", "possibly", "do", "here.")
        )
    ])
    transcript = transcript_with(words, duration=100.0)
    clip = Clip(start=0.0, end=13.0, title="x", score=8)

    path = C.build_ass(clip, transcript, tmp_path / "c.ass", font="Inter Bold")
    for line in dialogue_lines(path.read_text(encoding="utf-8")):
        parts = dialogue_text(line).split(BREAK)
        assert len(parts) <= config.CAPTION_MAX_LINES
        for part in parts:
            assert len(part) <= config.CAPTION_MAX_CHARS_PER_LINE


def test_build_ass_first_cue_starts_near_zero(tmp_path):
    words = sentence_words(start=500.0, count=10)
    transcript = transcript_with(words, duration=600.0)
    clip = Clip(start=500.0, end=515.0, title="x", score=8)

    path = C.build_ass(clip, transcript, tmp_path / "c.ass", font="Inter Bold")
    first = dialogue_lines(path.read_text(encoding="utf-8"))[0]
    assert first.startswith("Dialogue: 0,0:00:00.")


def test_build_ass_raises_when_clip_has_no_words(tmp_path):
    words = sentence_words(start=0.0, count=4)
    transcript = transcript_with(words, duration=100.0)
    clip = Clip(start=80.0, end=95.0, title="ទទេ", score=8)

    with pytest.raises(C.CaptionError, match="គ្មានពាក្យ"):
        C.build_ass(clip, transcript, tmp_path / "c.ass")


def test_build_all_captions_numbers_files(tmp_path):
    words = sentence_words(start=0.0, count=80, step=0.5)
    transcript = transcript_with(words, duration=100.0)
    clips = [
        Clip(start=0.0, end=16.0, title="a", score=9),
        Clip(start=20.0, end=36.0, title="b", score=8),
    ]
    paths = C.build_all_captions(clips, transcript, tmp_path, font="Inter Bold")
    assert [p.name for p in paths] == ["clip_01.ass", "clip_02.ass"]
    assert all(p.is_file() for p in paths)


def test_margin_v_defaults_to_config(tmp_path):
    words = sentence_words(start=0.0, count=10)
    transcript = transcript_with(words)
    path = C.build_ass(Clip(start=0.0, end=6.0, title="x", score=8), transcript,
                       tmp_path / "c.ass", font="Inter Bold")
    assert f",{config.CAPTION_MARGIN_V},1" in path.read_text(encoding="utf-8")


def test_margin_v_can_be_overridden_for_split(tmp_path):
    """ក្នុង split screen អក្សរត្រូវឡើងជិតស្នាមរវាងផ្ទាំងពីរ."""
    words = sentence_words(start=0.0, count=10)
    transcript = transcript_with(words)
    path = C.build_ass(Clip(start=0.0, end=6.0, title="x", score=8), transcript,
                       tmp_path / "c.ass", font="Inter Bold",
                       margin_v=config.CAPTION_MARGIN_V_SPLIT)
    assert f",{config.CAPTION_MARGIN_V_SPLIT},1" in path.read_text(encoding="utf-8")


def test_build_all_captions_accepts_per_clip_margins(tmp_path):
    words = sentence_words(start=0.0, count=80, step=0.5)
    transcript = transcript_with(words, duration=100.0)
    clips = [Clip(start=0.0, end=16.0, title="a", score=9),
             Clip(start=20.0, end=36.0, title="b", score=8)]
    paths = C.build_all_captions(clips, transcript, tmp_path, font="Inter Bold",
                                 margins=[880, None])
    assert ",880,1" in paths[0].read_text(encoding="utf-8")
    assert f",{config.CAPTION_MARGIN_V},1" in paths[1].read_text(encoding="utf-8")


def test_uppercase_is_applied_when_configured(monkeypatch):
    """style short-form: ALL CAPS អានលឿនជាងពេលរំកិលមើល."""
    monkeypatch.setattr(config, "CAPTION_UPPERCASE", True)
    words = make_words([("hello", 0, 1), ("world", 1, 2)])
    cue = C.Cue(start=0, end=2, lines=[words])
    text = C.cue_to_dialogue_text(cue, set(), config.CAPTION_KEYWORD_COLOR)
    assert "HELLO WORLD" in text


def test_uppercase_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_UPPERCASE", False)
    words = make_words([("hello", 0, 1)])
    cue = C.Cue(start=0, end=1, lines=[words])
    assert "hello" in C.cue_to_dialogue_text(cue, set(), config.CAPTION_KEYWORD_COLOR)


def test_keyword_matching_still_works_with_uppercase(monkeypatch):
    """ការបំលេចប្រៀបធៀបលើអក្សរតូច ដូច្នេះ ALL CAPS មិនបំបែកវាទេ."""
    monkeypatch.setattr(config, "CAPTION_UPPERCASE", True)
    words = make_words([("algorithm", 0, 1)])
    cue = C.Cue(start=0, end=1, lines=[words])
    text = C.cue_to_dialogue_text(cue, {"algorithm"}, config.CAPTION_KEYWORD_COLOR)
    assert C.ass_color(config.CAPTION_KEYWORD_COLOR) in text
    assert "ALGORITHM" in text


def test_cue_closes_at_sentence_end():
    """bug ពិត: cue ចាប់ផ្តើមដោយកន្ទុយប្រយោគមុន ("APPS. I THINK IN THE FUTURE,")."""
    words = make_words([
        ("different", 0.0, 0.5), ("apps.", 0.5, 1.0),
        ("I", 1.0, 1.3), ("think", 1.3, 1.6), ("in", 1.6, 1.9), ("the", 1.9, 2.2),
        ("future", 2.2, 2.6), ("every", 2.6, 3.0), ("business", 3.0, 3.5),
    ])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=3)

    first = cues[0].text()
    assert first.endswith("apps.")           # cue ទី ១ បញ្ចប់ត្រង់ចុងប្រយោគ
    assert not cues[1].text().startswith("apps")


def test_short_sentence_does_not_become_its_own_cue():
    """"Yeah." ខ្លីពេក -> មិនត្រូវបិទ cue ភ្លាមទេ (បើមិនដូច្នោះអក្សរភ្លឹបភ្លែត)."""
    words = make_words([
        ("Yeah.", 0.0, 0.4),
        ("I", 0.4, 0.7), ("think", 0.7, 1.0), ("so", 1.0, 1.3),
    ])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=3)
    assert cues[0].text().startswith("Yeah. I")


def test_sentence_break_respects_min_chars(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_MIN_CUE_CHARS", 100)   # ខ្ពស់ពេក -> មិនបិទ
    words = make_words([("apps.", 0.0, 0.5), ("Next", 0.5, 1.0), ("thing", 1.0, 1.5)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=30, max_lines=3)
    assert len(cues) == 1


def test_cue_never_opens_with_a_sentence_tail():
    """bug ពិត: "APPS. I THINK IN THE FUTURE," — កន្ទុយប្រយោគមុនបើក cue ថ្មី."""
    words = make_words([
        ("we", 0.0, 0.2), ("have", 0.2, 0.4), ("a", 0.4, 0.5), ("lot", 0.5, 0.7),
        ("of", 0.7, 0.8), ("different", 0.8, 1.2), ("apps.", 1.2, 1.5),
        ("I", 1.5, 1.6), ("think", 1.6, 1.9), ("in", 1.9, 2.0), ("the", 2.0, 2.1),
        ("future", 2.1, 2.5), ("every", 2.5, 2.8), ("business", 2.8, 3.2),
    ])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=3)
    for cue in cues:
        first = cue.text().split()[0]
        assert not first.endswith((".", "?", "!")), f"cue ចាប់ផ្តើមដោយកន្ទុយ: {cue.text()!r}"


def test_group_into_sentences():
    words = make_words([("one.", 0, 1), ("two", 1, 2), ("three?", 2, 3), ("four", 3, 4)])
    groups = C.group_into_sentences(words)
    assert [[w.word for w in g] for g in groups] == [["one."], ["two", "three?"], ["four"]]


def test_group_into_sentences_drops_empty_words():
    words = make_words([("  ", 0, 1), ("real.", 1, 2)])
    assert [w.word for w in C.group_into_sentences(words)[0]] == ["real."]


def test_short_sentences_share_a_cue_when_they_fit():
    """"Yeah." មិនត្រូវក្លាយជា cue ដាច់ដោយឡែកបើវាសមជាមួយប្រយោគបន្ទាប់."""
    words = make_words([("Yes.", 0.0, 0.3), ("No.", 0.3, 0.6)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=3)
    assert len(cues) == 1 and cues[0].text() == "Yes. No."


def test_long_sentence_still_splits_across_cues():
    """ប្រយោគវែងជាង cue មួយ -> ត្រូវបំបែក (ការបន្តមិនមែនជាកន្ទុយទេ)."""
    words = make_words([(f"word{i}", i * 0.3, i * 0.3 + 0.3) for i in range(30)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=2)
    assert len(cues) > 1


def test_long_sentence_splits_evenly_not_greedily():
    """bug ពិត: ការបំពេញបែប greedy ទុកពាក្យតែមួយនៅ cue ចុងក្រោយ ("APPS.")."""
    words = make_words([(f"word{i}", i * 0.3, i * 0.3 + 0.3) for i in range(13)]
                       + [("end.", 3.9, 4.2)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=2)
    lengths = [len(cue.text()) for cue in cues]
    assert min(lengths) > 8, f"cue ខ្លីពេក: {[c.text() for c in cues]}"


def test_no_single_word_cue_from_a_long_sentence():
    words = make_words([("we", 0.0, 0.2), ("have", 0.2, 0.4), ("a", 0.4, 0.5),
                        ("lot", 0.5, 0.7), ("of", 0.7, 0.8), ("different", 0.8, 1.2),
                        ("apps.", 1.2, 1.5)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=2)
    assert all(len(cue.text().split()) > 1 for cue in cues)


# ---------- ទីតាំងតាម layout ----------

def segment(start, end, kind):
    from pipeline.reframe import Box, Layout, Segment
    layout = Layout(kind=kind)
    if kind == "split":
        layout.panels = [Box(x=0, y=0, w=400, h=400), Box(x=500, y=0, w=400, h=400)]
    else:
        layout.box = Box(x=0, y=0, w=606, h=1080)
    return Segment(start=start, end=end, layout=layout)


def cue_at(start, end):
    return C.Cue(start=start, end=end, lines=[make_words([("hi", start, end)])])


def test_anchor_follows_the_segment_under_the_cue():
    segments = [segment(100.0, 110.0, "single"), segment(110.0, 120.0, "split")]
    assert C.anchor_for(cue_at(2.0, 4.0), 100.0, segments) == "normal"
    assert C.anchor_for(cue_at(12.0, 14.0), 100.0, segments) == "split"


def test_anchor_without_segments_is_normal():
    assert C.anchor_for(cue_at(0.0, 2.0), 0.0, None) == "normal"
    assert C.anchor_for(cue_at(0.0, 2.0), 0.0, []) == "normal"


def test_anchor_outside_any_segment_is_normal():
    assert C.anchor_for(cue_at(50.0, 52.0), 0.0, [segment(0.0, 10.0, "split")]) == "normal"


# ---------- គម្លាតបន្ទាត់ ----------

def test_line_gap_matches_config():
    ys = C.line_positions(3, "normal")
    gaps = [b - a for a, b in zip(ys, ys[1:])]
    assert gaps == [config.CAPTION_LINE_GAP, config.CAPTION_LINE_GAP]


def test_split_block_is_centred_on_the_seam():
    ys = C.line_positions(3, "split")
    assert (ys[0] + ys[-1]) / 2 == pytest.approx(config.OUT_HEIGHT / 2)


def test_normal_block_sits_above_the_margin():
    ys = C.line_positions(3, "normal")
    bottom = ys[-1] + config.CAPTION_FONT_SIZE / 2
    assert bottom == pytest.approx(config.OUT_HEIGHT - config.CAPTION_MARGIN_V)


def test_single_line_positions():
    assert len(C.line_positions(1, "split")) == 1
    assert C.line_positions(1, "split")[0] == pytest.approx(config.OUT_HEIGHT / 2)


# ---------- បំលេចតាមសំឡេង ----------

def cue_with_words(specs, clip_start=0.0):
    words = make_words(specs)
    return C.wrap_into_cues(words, clip_start=clip_start, max_chars=40, max_lines=2)[0], words


def test_word_intervals_are_continuous():
    cue, _ = cue_with_words([("one", 0.0, 0.4), ("two", 0.5, 0.9), ("three", 1.0, 1.6)])
    intervals = C.word_intervals(cue)
    for (_, end), (next_start, _) in zip(intervals, intervals[1:]):
        assert end == pytest.approx(next_start)      # គ្មានរន្ធ គ្មានការត្រួតគ្នា
    assert intervals[-1][1] == pytest.approx(cue.end)


def test_word_intervals_subtract_clip_start():
    """bug ពិត: ពាក្យផ្ទុកពេលដាច់ខាត cue ផ្ទុកពេលធៀប -> Dialogue បានពេលបញ្ច្រាស."""
    cue, _ = cue_with_words([("one", 500.0, 500.4), ("two", 500.5, 501.0)], clip_start=500.0)
    for start, end in C.word_intervals(cue, clip_start=500.0):
        assert 0.0 <= start < 10.0 and start < end


def test_word_intervals_respect_minimum_length(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_MIN_WORD_SEC", 0.2)
    cue, _ = cue_with_words([("a", 0.0, 0.02), ("b", 0.03, 0.5)])
    assert C.word_intervals(cue)[0][1] - C.word_intervals(cue)[0][0] >= 0.2


def test_active_word_is_bigger_and_coloured():
    words = make_words([("alpha", 0.0, 0.5), ("beta", 0.5, 1.0)])
    text = C.render_line(words, words[0])
    scale = int(round(config.CAPTION_ACTIVE_SCALE * 100))
    assert rf"\fscy{scale}" in text          # raw string: "\f" ធម្មតាជា formfeed
    assert C.ass_color(config.CAPTION_KEYWORD_COLOR) in text
    assert r"\fscy100" in text               # ត្រឡប់ទំហំដើមក្រោយពាក្យសកម្ម
    assert "BETA" in text


def test_inactive_words_have_no_tags():
    words = make_words([("alpha", 0.0, 0.5), ("beta", 0.5, 1.0)])
    assert C.render_line(words, None) == "ALPHA BETA"


def test_cue_events_cover_every_word_and_line():
    cue, words = cue_with_words([("one", 0.0, 0.3), ("two", 0.3, 0.6), ("three", 0.6, 1.0)])
    events = C.cue_events(cue, "normal")
    assert len(events) == len(words) * len(cue.lines)
    assert all("\pos(" in e for e in events)


def test_cue_events_fall_back_to_static_keyword(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_WORD_HIGHLIGHT", False)
    cue, _ = cue_with_words([("algorithm", 0.0, 0.5), ("works", 0.5, 1.0)])
    events = C.cue_events(cue, "normal")
    assert len(events) == len(cue.lines)         # Dialogue ១ ក្នុងមួយបន្ទាត់


def test_split_cue_events_sit_higher_than_normal():
    cue, _ = cue_with_words([("one", 0.0, 0.5)])
    normal_y = float(C.cue_events(cue, "normal")[0].split("\pos(540,")[1].split(")")[0])
    split_y = float(C.cue_events(cue, "split")[0].split("\pos(540,")[1].split(")")[0])
    assert split_y < normal_y


# ---------- ដែនពាក្យ និងការបំលេចដែលមិនលោត ----------

def test_cue_never_exceeds_the_word_cap():
    """ពាក្យច្រើនពេកក្នុង cue តែមួយ -> អ្នកមើលអានមិនទាន់."""
    words = make_words([(f"w{i}", i * 0.3, i * 0.3 + 0.3) for i in range(20)])
    for cue in C.wrap_into_cues(words, clip_start=0.0):
        assert sum(len(line) for line in cue.lines) <= config.CAPTION_MAX_WORDS_PER_CUE


def test_word_cap_is_configurable():
    words = make_words([(f"w{i}", i * 0.3, i * 0.3 + 0.3) for i in range(12)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_words=2)
    assert all(sum(len(l) for l in cue.lines) <= 2 for cue in cues)


def test_short_sentence_stays_one_cue_under_the_cap():
    words = make_words([("just", 0.0, 0.3), ("three", 0.3, 0.6), ("words.", 0.6, 1.0)])
    assert len(C.wrap_into_cues(words, clip_start=0.0)) == 1


def test_active_word_scales_vertically_not_horizontally():
    r"""bug ពិត: `\fs` ប្តូរទទឹងបន្ទាត់ ហើយអក្សរលោតពេលការបំលេចផ្លាស់ទី."""
    words = make_words([("alpha", 0.0, 0.5), ("beta", 0.5, 1.0)])
    text = C.render_line(words, words[0])
    assert r"\fscy" in text
    assert r"\fs1" not in text.replace(r"\fscy", "")    # គ្មាន \fs<size>


def test_scale_one_means_colour_only(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_ACTIVE_SCALE", 1.0)
    words = make_words([("alpha", 0.0, 0.5)])
    text = C.render_line(words, words[0])
    assert r"\fscy" not in text
    assert C.ass_color(config.CAPTION_KEYWORD_COLOR) in text


def test_plain_text_is_identical_whichever_word_is_active():
    """អត្ថបទដែលមើលឃើញត្រូវដូចគ្នា -> គ្មានហេតុផលឲ្យទទឹងប្រែប្រួល."""
    import re as _re
    words = make_words([("alpha", 0.0, 0.5), ("beta", 0.5, 1.0), ("gamma", 1.0, 1.5)])
    renders = [C.render_line(words, w) for w in words]
    plain = {_re.sub("[{][^}]*[}]", "", r) for r in renders}
    assert len(plain) == 1


def test_no_event_runs_past_its_cue():
    """bug ពិត: ច្បាប់ប្រវែងអប្បបរមារុញពាក្យចុងក្រោយហួស cue ហើយ caption ពីរលេចព្រមគ្នា."""
    words = make_words([("one", 0.0, 0.4), ("two", 0.4, 0.8), ("three", 0.8, 0.82)])
    cue = C.wrap_into_cues(words, clip_start=0.0, max_chars=40, max_lines=2)[0]
    for start, end in C.word_intervals(cue):
        assert start >= cue.start - 1e-9
        assert end <= cue.end + 1e-9


def test_consecutive_cues_never_overlap_on_screen():
    """cue តៗគ្នាមិនត្រូវលេចព្រមគ្នា — អក្សរពីរជាន់គ្នាអានមិនបាន."""
    specs = [(f"word{i}", i * 0.12, i * 0.12 + 0.11) for i in range(24)]
    words = make_words(specs)
    cues = C.wrap_into_cues(words, clip_start=0.0)
    spans = []
    for cue in cues:
        intervals = C.word_intervals(cue)
        spans.append((min(s for s, _ in intervals), max(e for _, e in intervals)))
    for (_, end), (next_start, _) in zip(spans, spans[1:]):
        assert end <= next_start + 1e-9


def test_zero_length_word_events_are_dropped():
    """ពាក្យចាប់ផ្តើមត្រង់ចុង cue -> event ប្រវែង 0 ដែលគ្មានអ្វីបង្ហាញ."""
    words = make_words([("one", 0.0, 0.5), ("two", 0.5, 1.0)])
    cue = C.Cue(start=0.0, end=0.5, lines=[words])       # "two" ចាប់ត្រង់ចុង
    for event in C.cue_events(cue, "normal"):
        parts = event[len("Dialogue: "):].split(",")
        assert parts[1] != parts[2], f"event ប្រវែង 0: {event[:60]}"


def test_cue_still_shows_when_every_interval_is_degenerate():
    words = make_words([("only", 2.0, 2.0)])
    cue = C.Cue(start=2.0, end=2.0, lines=[words])
    events = C.cue_events(cue, "normal")
    assert len(events) == 1        # fallback: បង្ហាញដោយគ្មានការបំលេច


# ---------- លុបវណ្ណយុត្តិ ----------

@pytest.mark.parametrize("raw,shown", [
    ("apps.", "apps"),
    ("business,", "business"),
    ("everything?", "everything"),
    ("wow!", "wow"),
    ("(aside)", "aside"),
    ('"quoted"', "quoted"),
    ("we've", "we've"),          # apostrophe រក្សា
    ("long-term", "long-term"),  # hyphen រក្សា
    ("agent.md", "agentmd"),
])
def test_display_word_strips_punctuation(raw, shown):
    assert C.display_word(raw) == shown


def test_display_word_can_be_turned_off(monkeypatch):
    monkeypatch.setattr(config, "CAPTION_STRIP_PUNCTUATION", False)
    assert C.display_word("apps.") == "apps."


def test_display_word_keeps_something_for_punctuation_only(monkeypatch):
    """ពាក្យដែលមានតែវណ្ណយុត្តិមិនត្រូវបាត់ទៅជាអក្សរទទេ."""
    assert C.display_word("--") == "--"
    assert C.display_word("...") == "..."


def test_rendered_line_has_no_punctuation():
    words = make_words([("apps.", 0.0, 0.3), ("we've", 0.3, 0.6), ("long-term", 0.6, 1.0)])
    text = C.render_line(words, None)
    assert text == "APPS WE'VE LONG-TERM"


def test_sentence_detection_still_uses_the_original_text():
    """ការលុបវណ្ណយុត្តិប៉ះតែការបង្ហាញ — cue នៅតែបិទត្រង់ចុងប្រយោគ."""
    words = make_words([("we", 0.0, 0.2), ("have", 0.2, 0.4), ("apps.", 0.4, 0.7),
                        ("I", 0.7, 0.8), ("think", 0.8, 1.1), ("so", 1.1, 1.4)])
    cues = C.wrap_into_cues(words, clip_start=0.0, max_chars=16, max_lines=3)
    assert cues[0].text().endswith("apps.")


# ---------- cue មិនត្រូវចប់ដោយពាក្យភ្ជាប់ ----------

def words_at(text: str, start: float = 0.0, step: float = 0.4) -> list[Word]:
    return [Word(word=w, start=start + i * step, end=start + (i + 1) * step,
                 probability=0.9)
            for i, w in enumerate(text.split())]


def last_words(cues) -> list[str]:
    return [C.display_word(cue.lines[-1][-1].word).lower() for cue in cues]


def test_cue_does_not_end_on_an_article():
    """"He's the brains behind the | operation" -> "behind | the operation"."""
    words = words_at("he is the brains behind the operation as far as business goes")
    cues = C.wrap_into_cues(words, 0.0, max_chars=30, max_lines=2, max_words=5)
    assert "the" not in last_words(cues)[:-1]


def test_cue_does_not_end_on_a_preposition():
    words = words_at("put full holograms into the world with a pretty wild future ahead")
    cues = C.wrap_into_cues(words, 0.0, max_chars=30, max_lines=2, max_words=5)
    for last in last_words(cues)[:-1]:
        assert last not in ("into", "the", "with", "a")


def test_carried_word_opens_the_next_cue():
    words = words_at("one two three four the fifth word here")
    cues = C.wrap_into_cues(words, 0.0, max_chars=40, max_lines=2, max_words=5)
    texts = [" ".join(C.display_word(w.word) for line in cue.lines for w in line)
             for cue in cues]
    assert not texts[0].lower().endswith(" the")


def test_a_cue_is_never_left_with_one_word():
    """ការដកពាក្យមិនត្រូវបង្កើត cue ១ ពាក្យដែលភ្លឹបភ្លែតទេ."""
    words = words_at("alpha the of in on at beta gamma delta epsilon zeta")
    cues = C.wrap_into_cues(words, 0.0, max_chars=40, max_lines=2, max_words=5)
    counts = [sum(len(line) for line in cue.lines) for cue in cues]
    assert min(counts[:-1] or [2]) >= 2


def test_sentences_still_group_together():
    """ច្បាប់ថ្មីមិនត្រូវបំផ្លាញការរៀបតាមប្រយោគទេ."""
    words = words_at("short one. a second sentence follows here now.")
    cues = C.wrap_into_cues(words, 0.0, max_chars=40, max_lines=2, max_words=5)
    first = " ".join(C.display_word(w.word) for line in cues[0].lines for w in line)
    assert first.lower().startswith("short one")
