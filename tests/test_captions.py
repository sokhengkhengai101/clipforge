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
    words = make_words([("the", 0, 1), ("algorithm", 1, 2), ("is", 2, 3), ("broken", 3, 4)])
    cue = C.Cue(start=0, end=4, lines=[words])
    assert C.pick_keywords(cue) == {"algorithm", "broken"}


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
