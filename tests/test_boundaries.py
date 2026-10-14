"""Test សម្រាប់ pipeline/boundaries.py.

យើងសាងសង់ transcript សាកល្បងដែលយើងគ្រប់គ្រងវណ្ណយុត្តិ និងការឈប់ ដើម្បីតេស្តការ
បំបែកប្រយោគឲ្យច្បាស់លាស់។
"""

import pytest

import config
from pipeline import boundaries as B
from pipeline.highlights import Clip
from pipeline.transcribe import Segment, Transcript, Word


def words_from(spec: list[tuple[str, float, float]]) -> list[Word]:
    return [Word(word=w, start=s, end=e, probability=0.9) for w, s, e in spec]


def transcript_from_words(words: list[Word], duration: float | None = None) -> Transcript:
    """ដាក់ពាក្យទាំងអស់ក្នុង segment តែមួយ (boundaries មិនខ្វល់ពី segment ទេ)."""
    segment = Segment(
        id=0,
        start=words[0].start if words else 0.0,
        end=words[-1].end if words else 0.0,
        text=" ".join(w.word.strip() for w in words),
        words=words,
    )
    return Transcript(
        language="en", language_probability=1.0,
        duration=duration if duration is not None else segment.end,
        model="test", device="cpu", segments=[segment],
    )


def simple_transcript(n_sentences: int = 3) -> Transcript:
    """ប្រយោគ n៖ 0-10s, 10-20s, ... (ពាក្យនីមួយៗ 1s)."""
    words: list[Word] = []
    for sentence_index in range(n_sentences):
        base = sentence_index * 10.0
        for word_index in range(10):
            text = f"w{word_index}"
            if word_index == 9:
                text += "."          # ពាក្យចុងក្រោយបញ្ចប់ប្រយោគ
            start = base + word_index
            words.append(Word(word=text, start=start, end=start + 1.0, probability=0.9))
    return transcript_from_words(words, duration=n_sentences * 10.0)


# ---------- _ends_sentence ----------

@pytest.mark.parametrize("text,expected", [
    ("hello.", True),
    ("really?", True),
    ("wow!", True),
    ('"done."', True),          # សញ្ញាសម្រង់ខាងក្រោយត្រូវលុបមុនពិនិត្យ
    ("maybe…", True),
    ("hello", False),
    (" word, ", False),
])
def test_ends_sentence(text, expected):
    assert B._ends_sentence(text) is expected


# ---------- build_sentences ----------

def test_build_sentences_splits_on_punctuation():
    sentences = B.build_sentences(simple_transcript())
    assert len(sentences) == 3
    assert (sentences[0].start, sentences[0].end) == (0.0, 10.0)
    assert (sentences[1].start, sentences[1].end) == (10.0, 20.0)


def test_build_sentences_splits_on_long_pause():
    """គ្មានវណ្ណយុត្តិ តែឈប់លើស 1s -> ត្រូវបំបែក (Whisper ជួនកាលភ្លេច `.`)."""
    words = words_from([
        ("hello", 0.0, 1.0),
        ("world", 1.0, 2.0),
        ("after", 5.0, 6.0),     # ឈប់ 3s
        ("pause", 6.0, 7.0),
    ])
    sentences = B.build_sentences(transcript_from_words(words))
    assert len(sentences) == 2
    assert sentences[0].text == "hello world"
    assert sentences[1].text == "after pause"


def test_build_sentences_keeps_short_pause_together():
    words = words_from([("a", 0.0, 1.0), ("b", 1.2, 2.0)])   # ឈប់ត្រឹម 0.2s
    assert len(B.build_sentences(transcript_from_words(words))) == 1


def test_build_sentences_falls_back_to_segments_without_words():
    """transcript ចាស់គ្មាន word timestamps -> ប្រើ segment ជាប្រយោគ."""
    segments = [
        Segment(id=0, start=0.0, end=5.0, text="first", words=[]),
        Segment(id=1, start=5.0, end=9.0, text="second", words=[]),
    ]
    transcript = Transcript(language="en", language_probability=1.0, duration=9.0,
                            model="t", device="cpu", segments=segments)
    sentences = B.build_sentences(transcript)
    assert [(s.start, s.end) for s in sentences] == [(0.0, 5.0), (5.0, 9.0)]


def test_build_sentences_handles_zero_length_words():
    """Whisper ឲ្យ start == end លើពាក្យខ្លីៗ ("Yeah.") — មិនត្រូវ crash."""
    words = words_from([("Yeah.", 10.0, 10.0), ("Right.", 12.0, 12.0)])
    sentences = B.build_sentences(transcript_from_words(words, duration=20.0))
    assert len(sentences) == 2
    assert sentences[0].start == sentences[0].end == 10.0


# ---------- snap ----------

def test_snap_moves_start_to_sentence_start():
    """clip ចាប់ផ្តើមពាក់កណ្តាលប្រយោគ -> ត្រូវរុញទៅដើមប្រយោគ (bug ពិតពី podcast)."""
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    clip = Clip(start=13.0, end=19.0, title="mid-sentence", score=8)

    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=5.0, max_sec=90.0, padding=0.0)
    assert snapped is not None
    assert snapped.start == 10.0        # ដើមប្រយោគទី ២ មិនមែន 13.0


def test_snap_moves_end_to_sentence_end():
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    clip = Clip(start=0.0, end=12.0, title="x", score=8)

    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=5.0, max_sec=90.0, padding=0.0)
    assert snapped.end in (10.0, 20.0)  # ចុងប្រយោគ មិនមែន 12.0


def test_snap_extends_short_clip_to_minimum():
    """clip 2s -> ត្រូវពន្លាតដល់ min (ករណី 'AI skills are overrated' 7s -> 19s)."""
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    clip = Clip(start=10.0, end=15.0, title="short", score=9)

    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=15.0, max_sec=90.0, padding=0.0)
    assert snapped is not None
    assert snapped.duration >= 15.0


def test_snap_trims_long_clip_to_maximum():
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    clip = Clip(start=0.0, end=30.0, title="long", score=7)

    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=5.0, max_sec=20.0, padding=0.0)
    assert snapped.duration <= 20.0
    assert snapped.end == 20.0          # កាត់ត្រង់ព្រំដែនប្រយោគ មិនមែនកាត់ឆៃឆៅ


def test_snap_drops_clip_that_cannot_reach_minimum():
    """transcript ទាំងមូលខ្លីជាង min -> ត្រូវបោះ ជាមួយ warning."""
    words = words_from([("only", 0.0, 3.0), ("words.", 3.0, 6.0)])   # transcript 6s
    transcript = transcript_from_words(words, duration=6.0)
    sentences = B.build_sentences(transcript)
    warnings = []

    result = B.snap_clip(Clip(start=0.0, end=6.0, title="tiny", score=9), sentences, 6.0,
                         min_sec=15.0, padding=0.0, on_warning=warnings.append)
    assert result is None
    assert warnings and "tiny" in warnings[0]


def test_snap_returns_none_without_sentences():
    assert B.snap_clip(Clip(start=0, end=30, title="x"), [], 100.0) is None


def test_snap_keeps_other_fields():
    """snap ប្តូរតែ start/end — title/score/type ត្រូវនៅដដែល."""
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    clip = Clip(start=11.0, end=19.0, title="keep me", hook="h", type="story",
                score=9, reason="r")
    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=5.0, padding=0.0)
    assert (snapped.title, snapped.hook, snapped.type, snapped.score, snapped.reason) == \
           ("keep me", "h", "story", 9.0, "r")


# ---------- padding ----------

def test_padding_is_applied():
    """ប្រយោគឆ្ងាយពីគ្នា -> padding ពេញ 0.3s ត្រូវបានបន្ថែម."""
    words = words_from([
        ("one.", 0.0, 1.0),
        ("target", 10.0, 11.0), ("sentence.", 11.0, 20.0),
        ("last.", 30.0, 31.0),
    ])
    transcript = transcript_from_words(words, duration=40.0)
    sentences = B.build_sentences(transcript)

    snapped = B.snap_clip(Clip(start=10.0, end=20.0, title="x"), sentences, 40.0,
                          min_sec=5.0, padding=0.3)
    assert snapped.start == pytest.approx(9.7)
    assert snapped.end == pytest.approx(20.3)


def test_padding_does_not_eat_neighbour_words():
    """ប្រយោគជិតគ្នា 0.1s -> padding ត្រូវកាត់ខ្លី កុំលេបពាក្យអ្នកជិតខាង."""
    words = words_from([
        ("before.", 0.0, 9.9),
        ("target", 10.0, 15.0), ("here.", 15.0, 20.0),
        ("after.", 20.1, 25.0),
    ])
    transcript = transcript_from_words(words, duration=30.0)
    sentences = B.build_sentences(transcript)

    snapped = B.snap_clip(Clip(start=10.0, end=20.0, title="x"), sentences, 30.0,
                          min_sec=5.0, padding=0.3)
    assert snapped.start >= 9.9      # មិនត្រូវចាប់ពាក្យ "before."
    assert snapped.end <= 20.1       # មិនត្រូវចាប់ពាក្យ "after."


def test_padding_clamped_to_video_bounds():
    transcript = simple_transcript()
    sentences = B.build_sentences(transcript)
    snapped = B.snap_clip(Clip(start=0.0, end=30.0, title="x"), sentences, 30.0,
                          min_sec=5.0, max_sec=90.0, padding=5.0)
    assert snapped.start >= 0.0
    assert snapped.end <= 30.0


# ---------- snap_boundaries ----------

def test_snap_boundaries_dedupes_after_snapping():
    """clip ២ ខុសគ្នាបន្តិច -> ក្រោយ snap ក្លាយដូចគ្នា -> រក្សាតែមួយ."""
    transcript = simple_transcript()
    clips = [
        Clip(start=11.0, end=19.0, title="ទាប", score=6),
        Clip(start=12.0, end=18.0, title="ខ្ពស់", score=9),
    ]
    result = B.snap_boundaries(clips, transcript)
    assert len(result) == 1
    assert result[0].title == "ខ្ពស់"      # score ខ្ពស់ឈ្នះ


def test_snap_boundaries_sorts_by_score():
    transcript = simple_transcript(n_sentences=10)     # 100s
    clips = [
        Clip(start=0.0, end=18.0, title="a", score=5),
        Clip(start=60.0, end=78.0, title="b", score=9),
    ]
    result = B.snap_boundaries(clips, transcript)
    assert [c.title for c in result] == ["b", "a"]     # score ខ្ពស់មុន


def test_snap_extends_backward_only_when_forward_is_impossible():
    """clip នៅចុង transcript -> ពន្លាតទៅក្រោយ (ឥរិយាបថដែល test មុនបានបង្ហាញ)."""
    transcript = simple_transcript(n_sentences=3)      # 30s
    sentences = B.build_sentences(transcript)
    clip = Clip(start=20.0, end=29.0, title="ចុងបញ្ចប់", score=8)

    snapped = B.snap_clip(clip, sentences, 30.0, min_sec=15.0, padding=0.0)
    assert snapped.end == 30.0        # ទៅមុខអស់ហើយ
    assert snapped.start == 10.0      # ទើបពន្លាតទៅក្រោយមួយប្រយោគ
    assert snapped.duration >= 15.0


def test_snap_boundaries_uses_config_defaults():
    """គ្មាន min_sec -> ត្រូវប្រើ config.MIN_CLIP_SEC (15s)."""
    transcript = simple_transcript()
    clips = [Clip(start=10.0, end=16.0, title="x", score=8)]
    result = B.snap_boundaries(clips, transcript)
    assert result[0].duration >= config.MIN_CLIP_SEC


def test_snap_boundaries_empty_input():
    assert B.snap_boundaries([], simple_transcript()) == []


# ---------- clip_text ----------

def test_clip_text_returns_words_in_range():
    transcript = simple_transcript()
    clip = Clip(start=10.0, end=20.0, title="x")
    text = B.clip_text(clip, transcript)
    assert text.startswith("w0") and text.endswith("w9.")


def test_clip_text_falls_back_to_segments():
    segments = [Segment(id=0, start=0.0, end=10.0, text="segment text", words=[])]
    transcript = Transcript(language="en", language_probability=1.0, duration=10.0,
                            model="t", device="cpu", segments=segments)
    assert B.clip_text(Clip(start=0.0, end=10.0, title="x"), transcript) == "segment text"
