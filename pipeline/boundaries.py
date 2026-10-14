"""ជំហាន 4 — snap start/end ទៅព្រំដែនប្រយោគ, បន្ថែម padding, កំណត់ 15-90s.

**ហេតុអ្វីត្រូវមានជំហាននេះ?** LLM រក *កន្លែង* ល្អបាន តែព្រំដែនវាមិនច្បាស់។ ពេលយើងសាក
លើ podcast ពិត 4 ក្នុង 5 clip ចាប់ផ្តើមពាក់កណ្តាលប្រយោគ (ឧ. "works. Why skills are...")។
ជំហាននេះប្រើ **word timestamps** ដែល `transcribe.py` ទាញបាន ដើម្បីកែវាដោយកូដ
មិនមែនដោយសុំ LLM ម្តងទៀត។

ដំណើរការ៖
  1. បំបែក transcript ជាប្រយោគ (តាម `.` `?` `!` ឬការឈប់យូរ)
  2. រុញ start ទៅដើមប្រយោគជិតបំផុត, រុញ end ទៅចុងប្រយោគជិតបំផុត
  3. clip ខ្លីពេក -> ពន្លាតទៅប្រយោគបន្ទាប់/មុន ដល់ 15s
  4. clip វែងពេក -> កាត់ត្រឡប់ត្រង់ព្រំដែនប្រយោគ ក្រោម 90s
  5. បន្ថែម padding 0.3s តែកុំឲ្យលេបពាក្យអ្នកជិតខាង
"""

from dataclasses import dataclass, field
from typing import Callable

import config
from pipeline.highlights import Clip, dedupe_overlaps
from pipeline.transcribe import Transcript, Word

# ការឈប់វែងជាងនេះចាត់ទុកជាព្រំដែនប្រយោគ ទោះគ្មានវណ្ណយុត្តិ
# (Whisper ជួនកាលមិនដាក់ `.` នៅចុងប្រយោគ)
PAUSE_SEC = 1.0

# តួអក្សរដែលបញ្ជាក់ថាប្រយោគចប់
SENTENCE_ENDINGS = (".", "?", "!", "…")


@dataclass
class Sentence:
    """ប្រយោគមួយ + ពេលវេលាពិតរបស់វា (គណនាពី word timestamps)."""

    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)


def _ends_sentence(word_text: str) -> bool:
    """ពាក្យនេះបញ្ចប់ប្រយោគឬអត់? (លុបសញ្ញាសម្រង់/វង់ចេញមុន)"""
    cleaned = word_text.strip().rstrip('"\'»)]}')
    return cleaned.endswith(SENTENCE_ENDINGS)


def build_sentences(transcript: Transcript) -> list[Sentence]:
    """បំបែក transcript ទាំងមូលជាបញ្ជីប្រយោគ.

    បើ transcript គ្មាន word timestamps (ឧ. cache ចាស់) យើងប្រើ segment ជាប្រយោគ
    ជំនួស — មិនល្អស្មើ តែមិនដាច់។
    """
    all_words: list[Word] = [w for seg in transcript.segments for w in seg.words]

    if not all_words:
        # fallback: segment ជាប្រយោគ
        return [
            Sentence(start=s.start, end=s.end, text=s.text, words=[])
            for s in transcript.segments
        ]

    sentences: list[Sentence] = []
    current: list[Word] = []

    for i, word in enumerate(all_words):
        current.append(word)

        next_word = all_words[i + 1] if i + 1 < len(all_words) else None
        long_pause = next_word is not None and (next_word.start - word.end) > PAUSE_SEC

        if _ends_sentence(word.word) or long_pause or next_word is None:
            text = " ".join(w.word.strip() for w in current).strip()
            sentences.append(Sentence(
                start=current[0].start, end=current[-1].end, text=text, words=list(current),
            ))
            current = []

    return sentences


def _nearest_start(sentences: list[Sentence], time: float) -> float:
    """ដើមប្រយោគជិតបំផុតនឹង `time` (ដើម្បីកុំចាប់ផ្តើមពាក់កណ្តាលប្រយោគ).

    បើ `time` ធ្លាក់ក្នុងប្រយោគមួយ យើងជ្រើសរវាងដើមប្រយោគនោះ និងដើមប្រយោគបន្ទាប់
    — មួយណាជិតជាង។ បែបនេះយើងមិនអូសប្រយោគវែងមួយទាំងមូលចូលដោយអត់ការ។
    """
    candidates = [s.start for s in sentences]
    return min(candidates, key=lambda t: abs(t - time))


def _nearest_end(sentences: list[Sentence], time: float) -> float:
    """ចុងប្រយោគជិតបំផុតនឹង `time`."""
    candidates = [s.end for s in sentences]
    return min(candidates, key=lambda t: abs(t - time))


def _extend_to_min(start: float, end: float, sentences: list[Sentence],
                   min_sec: float) -> tuple[float, float]:
    """ពន្លាត clip ខ្លីពេកដោយបន្ថែមប្រយោគ — ទៅមុខជាមុន រួចទៅក្រោយ."""
    # ទៅមុខ: យកចុងប្រយោគបន្ទាប់ៗ
    for sentence in sentences:
        if end - start >= min_sec:
            break
        if sentence.end > end:
            end = sentence.end

    # បើនៅខ្លី: ទៅក្រោយ (តាមលំដាប់បញ្ច្រាស)
    for sentence in reversed(sentences):
        if end - start >= min_sec:
            break
        if sentence.start < start:
            start = sentence.start

    return start, end


def _trim_to_max(start: float, end: float, sentences: list[Sentence],
                 max_sec: float, min_sec: float) -> tuple[float, float]:
    """កាត់ clip វែងពេកត្រង់ព្រំដែនប្រយោគ (រក្សាដើម, កាត់ចុង)."""
    if end - start <= max_sec:
        return start, end

    # ចុងប្រយោគធំបំផុតដែលនៅក្នុងដែន max
    fits = [s.end for s in sentences if start < s.end <= start + max_sec]
    if fits and max(fits) - start >= min_sec:
        return start, max(fits)

    # គ្មានព្រំដែនប្រយោគសមទេ -> កាត់ត្រង់ max (ករណីកម្រ: និយាយវែងឥតឈប់)
    return start, start + max_sec


def _pad(start: float, end: float, sentences: list[Sentence], video_duration: float,
         padding: float) -> tuple[float, float]:
    """បន្ថែម padding ប៉ុន្តែកុំលេបពាក្យរបស់ប្រយោគជិតខាង.

    គោលបំណង padding គឺចាប់ដង្ហើមមុននិយាយ — មិនមែនចាប់ពាក្យមុនទេ។
    """
    # ចុងប្រយោគមុន (ជិតបំផុតនៅខាងឆ្វេង) = ដែនកំណត់របស់ padding ខាងដើម
    ends_before = [s.end for s in sentences if s.end <= start]
    starts_after = [s.start for s in sentences if s.start >= end]

    lower_limit = max(ends_before) if ends_before else 0.0
    upper_limit = min(starts_after) if starts_after else video_duration

    new_start = max(0.0, start - padding, lower_limit)
    new_end = min(video_duration, end + padding, upper_limit)

    # ករណីចំលែក (ប្រយោគជិតគ្នាពេក) -> កុំឲ្យ clip ត្រឡប់ក្រោយ
    if new_end <= new_start:
        return start, end
    return new_start, new_end


def snap_clip(
    clip: Clip,
    sentences: list[Sentence],
    video_duration: float,
    *,
    min_sec: float | None = None,
    max_sec: float | None = None,
    padding: float | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> Clip | None:
    """កែព្រំដែន clip មួយ. ត្រឡប់ `None` បើវាមិនអាចសង្គ្រោះបាន."""
    min_sec = config.MIN_CLIP_SEC if min_sec is None else min_sec
    max_sec = config.MAX_CLIP_SEC if max_sec is None else max_sec
    padding = config.PADDING_SEC if padding is None else padding

    if not sentences:
        return None

    start = _nearest_start(sentences, clip.start)
    end = _nearest_end(sentences, clip.end)

    # បើ snap ធ្វើឲ្យបញ្ច្រាស (clip ខ្លីជាងប្រយោគមួយ) -> យកប្រយោគដែលគ្របលើ start
    if end <= start:
        covering = [s for s in sentences if s.start <= start < s.end or s.start >= start]
        if not covering:
            if on_warning:
                on_warning(f"'{clip.title}' ត្រូវបោះ: រកប្រយោគសមមិនបាន")
            return None
        end = covering[0].end

    start, end = _extend_to_min(start, end, sentences, min_sec)
    start, end = _trim_to_max(start, end, sentences, max_sec, min_sec)
    start, end = _pad(start, end, sentences, video_duration, padding)

    duration = end - start
    if duration < min_sec:
        if on_warning:
            on_warning(f"'{clip.title}' ត្រូវបោះ: ពន្លាតដល់ត្រឹម {duration:.1f}s (< {min_sec:.0f}s)")
        return None

    return clip.model_copy(update={"start": round(start, 2), "end": round(end, 2)})


def snap_boundaries(
    clips: list[Clip],
    transcript: Transcript,
    *,
    on_warning: Callable[[str], None] | None = None,
) -> list[Clip]:
    """កែព្រំដែន clip ទាំងអស់ រួច dedupe ម្តងទៀត.

    **ហេតុអ្វី dedupe ម្តងទៀត?** ក្រោយ snap, clip ២ ដែលខុសគ្នាបន្តិចអាចក្លាយជាដូចគ្នា
    ទាំងស្រុង (ព្រោះវាធ្លាក់ទៅប្រយោគដូចគ្នា)។
    """
    sentences = build_sentences(transcript)
    video_duration = transcript.duration

    snapped: list[Clip] = []
    for clip in clips:
        result = snap_clip(clip, sentences, video_duration, on_warning=on_warning)
        if result is not None:
            snapped.append(result)

    deduped = dedupe_overlaps(snapped)
    deduped.sort(key=lambda c: c.score, reverse=True)
    return deduped


def clip_text(clip: Clip, transcript: Transcript) -> str:
    """អត្ថបទដែលនិយាយក្នុង clip នេះ — មានប្រយោជន៍ពេលពិនិត្យ និងសម្រាប់ captions."""
    words = [
        w for seg in transcript.segments for w in seg.words
        if w.end > clip.start and w.start < clip.end
    ]
    if words:
        return " ".join(w.word.strip() for w in words).strip()
    parts = [s.text for s in transcript.segments if s.end > clip.start and s.start < clip.end]
    return " ".join(parts).strip()
