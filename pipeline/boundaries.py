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
    """ប្រយោគមួយ + ពេលវេលាពិតរបស់វា (គណនាពី word timestamps).

    `hard` = ប្រយោគនេះចប់ដោយ `.` `?` `!` ពិតៗ។ បើ `False` វាចប់ត្រឹមការឈប់ដកដង្ហើម
    ហើយ**គំនិតមិនទាន់ចប់ទេ** (ឧ. "This was like")។ ក្នុង podcast ពិតមួយ 11% នៃ
    ប្រយោគជាប្រភេទនេះ ហើយការបញ្ចប់ clip ត្រង់ពួកវាធ្វើឲ្យ clip ដាច់កណ្តាលគំនិត។
    """

    start: float
    end: float
    text: str
    words: list[Word] = field(default_factory=list)
    hard: bool = True


def ends_sentence(word_text: str) -> bool:
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

        closed_by_punctuation = ends_sentence(word.word)
        if closed_by_punctuation or long_pause or next_word is None:
            text = " ".join(w.word.strip() for w in current).strip()
            sentences.append(Sentence(
                start=current[0].start, end=current[-1].end, text=text, words=list(current),
                hard=closed_by_punctuation,
            ))
            current = []

    return sentences


# ---------- ការផ្សាយពាណិជ្ជកម្ម ----------

@dataclass
class AdSpan:
    """ចន្លោះពេលដែលជាការផ្សាយពាណិជ្ជកម្ម (មិនត្រូវដាក់ក្នុង clip)."""

    start: float
    end: float
    reason: str = ""

    def overlaps(self, start: float, end: float) -> bool:
        return start < self.end and end > self.start


def _matching_phrases(text: str, phrases: tuple[str, ...]) -> list[str]:
    low = text.lower()
    return [p for p in phrases if p in low]


def _phrase_start_time(sentence: Sentence, phrase: str) -> float | None:
    """ពេលនៃ**ពាក្យទីមួយ**នៃឃ្លានោះ (មិនមែនដើមប្រយោគ).

    ត្រូវការព្រោះប្រយោគមួយអាចផ្ទុកទាំងរឿងល្អ ទាំងដើមការផ្សាយ៖
    "...before stand-up Wow This episode is sponsored by..." — យើងចង់កាត់ត្រង់
    "This" មិនមែនត្រង់ដើមប្រយោគទេ។
    """
    tokens = phrase.split()
    words = [w.word.strip().lower().strip(".,!?…") for w in sentence.words]
    for index in range(len(words) - len(tokens) + 1):
        if words[index:index + len(tokens)] == tokens:
            return sentence.words[index].start
    return None


def find_ad_spans(sentences: list[Sentence],
                  video_duration: float) -> list[AdSpan]:
    """រកចន្លោះការផ្សាយក្នុង transcript.

    ឃ្លា "ដើម" (`sponsored by`) ជាពាក្យ**ទីមួយ**នៃការអាន ចំណែកឃ្លា CTA
    (`40% off`, `com slash`) នៅ**ចុង** — ដូច្នេះយើងថយក្រោយពី CTA តែប៉ុណ្ណោះ។
    បើចង្កោមមានឃ្លា "ដើម" យើងជឿវាជាងការប៉ាន់ថយក្រោយ។
    """
    seeds = []
    for sentence in sentences:
        starts = _matching_phrases(sentence.text, config.AD_START_PHRASES)
        ctas = _matching_phrases(sentence.text, config.AD_CTA_PHRASES)
        if starts or ctas:
            seeds.append((sentence, starts, (starts + ctas)[0]))

    if not seeds:
        return []

    # ដាក់ seed ជិតគ្នាជាចង្កោមតែមួយ (ការផ្សាយ ២ ជាប់គ្នាក៏ជា block តែមួយដែរ)
    clusters: list[list[tuple[Sentence, list[str], str]]] = [[seeds[0]]]
    for seed in seeds[1:]:
        if seed[0].start - clusters[-1][-1][0].end <= config.AD_MERGE_SEC:
            clusters[-1].append(seed)
        else:
            clusters.append([seed])

    spans: list[AdSpan] = []
    for cluster in clusters:
        # ឃ្លាជាច្រើនអាចប៉ះប្រយោគតែមួយ ("this episode is sponsored" និង
        # "sponsored by") — យកមួយដែលចាប់ផ្តើម**មុនគេ** បើមិនដូច្នោះពាក្យដំបូងនៃ
        # ការផ្សាយ ("This episode") នៅសល់ក្នុង clip។
        hard_starts = [
            min((_phrase_start_time(s, phrase) or s.start) for phrase in starts)
            for s, starts, _ in cluster if starts
        ]
        if hard_starts:
            start = min(hard_starts) - 0.5      # ការអានចាប់ផ្តើមត្រង់ឃ្លានោះ
        else:
            start = cluster[0][0].start - config.AD_CTA_LEAD_SEC
        end = cluster[-1][0].end + config.AD_TAIL_SEC
        spans.append(AdSpan(
            start=max(0.0, start), end=min(video_duration, end),
            reason=", ".join(sorted({phrase for _, _, phrase in cluster})),
        ))
    return spans


def _avoid_ads(start: float, end: float, sentences: list[Sentence],
               ad_spans: list[AdSpan]) -> tuple[float, float] | None:
    """រុញព្រំដែនឲ្យផុតពីការផ្សាយ. `None` = clip ស្ថិតក្នុងការផ្សាយទាំងស្រុង."""
    for span in ad_spans:
        if not span.overlaps(start, end):
            continue
        if span.start <= start and span.end >= end:
            return None                       # ទាំង clip ជាការផ្សាយ
        # ចំណាំ: ប្រយោគមួយអាចឆ្លងពីខ្លឹមសារល្អចូលការផ្សាយ (ឧ. "...before stand-up
        # Wow This episode is sponsored by...")។ ពេលនោះព្រំដែនប្រយោគជិតបំផុតនៅ
        # ឆ្ងាយដល់ ១២ វិនាទី ហើយការកាត់ត្រង់នោះបោះខ្លឹមសារល្អចោល — យើងកាត់ត្រង់
        # ដើមការផ្សាយផ្ទាល់វិញ។
        limit = config.SNAP_HARD_END_SEC
        if span.start > start:
            # ការផ្សាយនៅខាងចុង -> ឈប់មុនវា
            fits = [s.end for s in sentences if start < s.end <= span.start]
            best = max(fits) if fits else span.start
            end = best if span.start - best <= limit else span.start
        else:
            # ការផ្សាយនៅខាងដើម -> ចាប់ផ្តើមក្រោយវា
            fits = [s.start for s in sentences if span.end <= s.start < end]
            best = min(fits) if fits else span.end
            start = best if best - span.end <= limit else span.end
        if end <= start:
            return None
    return start, end


def _clean_token(text: str) -> str:
    return text.strip().lower().strip(".,!?…\"'")


def is_filler_word(text: str) -> bool:
    """ពាក្យនេះជាការឆ្លើយតបទទេឬទេ ("yeah", "right", "um")?"""
    return _clean_token(text) in config.FILLER_WORDS


def is_filler_sentence(sentence: Sentence) -> bool:
    """ប្រយោគទាំងមូលជាការឆ្លើយតប ("Yeah. Yeah. Right.") — មិនសមជាដើម clip."""
    tokens = [t for t in sentence.text.split() if _clean_token(t)]
    return bool(tokens) and all(is_filler_word(t) for t in tokens)


def _trim_leading_filler(start: float, sentences: list[Sentence],
                         padding: float) -> float:
    """រុញ start ឲ្យផុតពាក្យបំពេញនាំមុខក្នុងប្រយោគដំបូង.

    "Yeah, so yeah, please go back to the 70s" -> ចាប់ត្រង់ "please"។ យើងដក
    បានត្រឹម `FILLER_MAX_STRIP` ពាក្យ ហើយតែពេលប្រយោគនៅសល់វែងល្មម ដើម្បីកុំឲ្យ
    clip ចាប់ផ្តើមកណ្តាលឃ្លាខ្លី។
    """
    # ប្រយោគដែល **ផ្ទុក** `start` (បើគ្មាន យកប្រយោគបន្ទាប់) — ការយក
    # "ប្រយោគដំបូងដែលចប់ក្រោយ start" ជ្រើសប្រយោគមុនខុស ហើយការកាត់មិនកើត។
    sentence = next((s for s in sentences if s.words and s.start <= start < s.end), None)
    if sentence is None:
        sentence = next((s for s in sentences if s.words and s.start >= start), None)
    if sentence is None:
        return start

    words = [w for w in sentence.words if w.start >= start - 0.05]
    tokens = [_clean_token(w.word) for w in words]

    # រំលងដល់ **ពាក្យបំពេញចុងក្រោយ** ក្នុងពាក្យដំបូងៗ។ ពាក្យតភ្ជាប់នៅចន្លោះ
    # ("so" ក្នុង "Yeah, so yeah, please...") ត្រូវរំលងដែរ — តែបើក្រោយវាគ្មាន
    # ពាក្យបំពេញទៀតទេ យើងមិនកាត់វាចោលឡើយ។
    strip = index = 0
    while index < min(config.FILLER_MAX_STRIP, len(tokens)):
        phrase = next((p for p in config.FILLER_PHRASES
                       if tuple(tokens[index:index + len(p)]) == p), None)
        if phrase is not None:
            index += len(phrase)
            strip = index
        elif is_filler_word(tokens[index]):
            index += 1
            strip = index
        else:
            index += 1          # ពាក្យតភ្ជាប់ -> មើលបន្តទៀត
    if strip == 0 or len(words) - strip < config.FILLER_MIN_KEEP:
        return start

    first = words[strip]
    # ទុកដកដង្ហើមបន្តិច តែកុំលេបពាក្យបំពេញដែលទើបដកចេញវិញ
    return max(words[strip - 1].end, first.start - padding)


def _nearest_start(sentences: list[Sentence], time: float,
                   tolerance: float | None = None) -> float:
    """ដើមប្រយោគជិតបំផុតនឹង `time` (ដើម្បីកុំចាប់ផ្តើមពាក់កណ្តាលប្រយោគ).

    ប្រយោគដែលជាការឆ្លើយតបសុទ្ធ ("Yeah.") ត្រូវរំលង បើមានដើមប្រយោគពិតក្នុងចម្ងាយ
    `tolerance` — វិនាទីដំបូងនៃ clip ជាវិនាទីដែលសម្រេចថាគេមើលបន្តឬរំកិលចោល។
    """
    tolerance = config.SNAP_HARD_END_SEC if tolerance is None else tolerance

    real = [s.start for s in sentences
            if not is_filler_sentence(s) and abs(s.start - time) <= tolerance]
    if real:
        return min(real, key=lambda t: abs(t - time))
    return min((s.start for s in sentences), key=lambda t: abs(t - time))


def _nearest_end(sentences: list[Sentence], time: float,
                 tolerance: float | None = None) -> float:
    """ចុងប្រយោគជិតបំផុតនឹង `time` — **ចូលចិត្តប្រយោគដែលចប់ពិត**.

    បើមានចុងប្រយោគពិត (`.?!`) ក្នុងចម្ងាយ `tolerance` យើងយកវា ទោះមានចុងប្រភេទ
    "ឈប់ដកដង្ហើម" ជិតជាង។ បើគ្មាន យើងត្រឡប់ទៅយកជិតបំផុតគ្រប់ប្រភេទ (កុំឲ្យ
    clip លោតទៅឆ្ងាយ ៣០ វិនាទីដើម្បីរកចំណុច)។
    """
    tolerance = config.SNAP_HARD_END_SEC if tolerance is None else tolerance

    hard = [s.end for s in sentences if s.hard and abs(s.end - time) <= tolerance]
    if hard:
        return min(hard, key=lambda t: abs(t - time))
    return min((s.end for s in sentences), key=lambda t: abs(t - time))


def _is_hard_end(sentences: list[Sentence], time: float) -> bool:
    """ពេលនេះជាចុងប្រយោគពិតឬអត់ (ក្នុងល្អៀង 10ms)?"""
    return any(s.hard and abs(s.end - time) < 0.01 for s in sentences)


def _extend_to_min(start: float, end: float, sentences: list[Sentence],
                   min_sec: float,
                   ad_spans: list[AdSpan] | None = None) -> tuple[float, float]:
    """ពន្លាត clip ខ្លីពេកដោយបន្ថែមប្រយោគ — ទៅមុខជាមុន រួចទៅក្រោយ.

    ការពន្លាតមិនត្រូវឆ្លងចូលការផ្សាយពាណិជ្ជកម្មទេ។ បើខាងមុខជាប់ការផ្សាយ យើងឈប់
    ហើយទៅយកប្រយោគខាងក្រោយវិញ (បើមិនដូច្នោះ clip ល្អនឹងត្រូវកាត់ខ្លី រួចបោះចោល)។
    """
    # ទៅមុខ: យកចុងប្រយោគបន្ទាប់ៗ — ហើយបើដល់ប្រវែងហើយតែគំនិតមិនទាន់ចប់
    # (`hard=False`) បន្តទៅចុងពិតបន្ទាប់ ក្នុងដែន `extra`។
    def in_ad(moment: float) -> bool:
        return any(s.start < moment <= s.end for s in (ad_spans or []))

    extra = config.SNAP_HARD_END_SEC
    for sentence in sentences:
        if sentence.end <= end:
            continue
        if in_ad(sentence.end):
            break                   # ខាងមុខជាការផ្សាយ -> ឈប់
        long_enough = end - start >= min_sec
        if long_enough and (_is_hard_end(sentences, end) or sentence.end - start > min_sec + extra):
            break
        end = sentence.end

    # បើនៅខ្លី: ទៅក្រោយ (តាមលំដាប់បញ្ច្រាស)
    for sentence in reversed(sentences):
        if end - start >= min_sec:
            break
        if sentence.start >= start:
            continue
        if in_ad(sentence.start):
            break
        # កុំទាញពាក្យបំពេញចូលវិញពេលថយក្រោយ ("Yeah, I built...")
        start = _trim_leading_filler(sentence.start, sentences, 0.0)

    return start, end


def _trim_to_max(start: float, end: float, sentences: list[Sentence],
                 max_sec: float, min_sec: float) -> tuple[float, float]:
    """កាត់ clip វែងពេកត្រង់ព្រំដែនប្រយោគ (រក្សាដើម, កាត់ចុង)."""
    if end - start <= max_sec:
        return start, end

    # ចុងប្រយោគធំបំផុតដែលនៅក្នុងដែន max — ចុងពិតមានអាទិភាព
    fits = [s.end for s in sentences if start < s.end <= start + max_sec]
    hard_fits = [s.end for s in sentences
                 if s.hard and start < s.end <= start + max_sec and s.end - start >= min_sec]
    if hard_fits:
        return start, max(hard_fits)
    if fits and max(fits) - start >= min_sec:
        return start, max(fits)

    # គ្មានព្រំដែនប្រយោគសមទេ -> កាត់ត្រង់ max (ករណីកម្រ: និយាយវែងឥតឈប់)
    return start, start + max_sec


def _pad(start: float, end: float, sentences: list[Sentence], video_duration: float,
         padding: float) -> tuple[float, float]:
    """បន្ថែម padding ប៉ុន្តែកុំលេបពាក្យរបស់ប្រយោគជិតខាង.

    គោលបំណង padding គឺចាប់ដង្ហើមមុននិយាយ — មិនមែនចាប់ពាក្យមុនទេ។
    """
    # ដែនកំណត់ត្រូវជាព្រំដែន **ពាក្យ** មិនមែនប្រយោគ៖ padding 0.3s អាចចូលកណ្តាល
    # ពាក្យមុន ហើយអ្នកមើលឮកន្ទុយពាក្យនោះ (យើងឃើញ "Yeah," ត្រឡប់ចូលវិញបែបនេះ)។
    words = [w for s in sentences for w in s.words]
    ends_before = [w.end for w in words if w.end <= start]
    starts_after = [w.start for w in words if w.start >= end]
    if not words:      # transcript ចាស់គ្មាន word timestamps -> ប្រើប្រយោគវិញ
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
    ad_spans: list[AdSpan] | None = None,
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

    # ការផ្សាយពាណិជ្ជកម្មៈ រុញព្រំដែនឲ្យផុត **មុន** ពន្លាត (បើមិនដូច្នោះ ការពន្លាត
    # នឹងអូសវាចូលវិញ) ហើយ**ក្រោយ** padding ម្តងទៀត។
    if ad_spans:
        avoided = _avoid_ads(start, end, sentences, ad_spans)
        if avoided is None:
            if on_warning:
                on_warning(f"'{clip.title}' ត្រូវបោះ: ស្ថិតក្នុងការផ្សាយពាណិជ្ជកម្ម")
            return None
        start, end = avoided

    # កាត់ពាក្យបំពេញ **មុន** ការពន្លាត ដើម្បីឲ្យការពន្លាតសងប្រវែងដែលបាត់វិញ
    # (បើកាត់ក្រោយ clip អាចធ្លាក់ក្រោម min រួចយើងត្រូវបោះការកាត់ចោល)។
    start = _trim_leading_filler(start, sentences, padding)

    start, end = _extend_to_min(start, end, sentences, min_sec, ad_spans)
    start, end = _trim_to_max(start, end, sentences, max_sec, min_sec)
    start, end = _pad(start, end, sentences, video_duration, padding)

    if ad_spans:
        avoided = _avoid_ads(start, end, sentences, ad_spans)
        if avoided is None:
            if on_warning:
                on_warning(f"'{clip.title}' ត្រូវបោះ: ស្ថិតក្នុងការផ្សាយពាណិជ្ជកម្ម")
            return None
        if avoided != (start, end) and on_warning:
            on_warning(f"'{clip.title}' ត្រូវកាត់ឲ្យផុតការផ្សាយពាណិជ្ជកម្ម")
        start, end = avoided

    # ពាក្យបំពេញនាំមុខត្រូវដកចេញ **ក្រោយ** padding បើមិនដូច្នោះ padding ទាញវាចូលវិញ
    trimmed_start = _trim_leading_filler(start, sentences, padding)
    if end - trimmed_start >= min_sec:
        start = trimmed_start

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
    ad_spans = find_ad_spans(sentences, video_duration)
    if ad_spans and on_warning:
        total = sum(s.end - s.start for s in ad_spans)
        on_warning(f"ការផ្សាយពាណិជ្ជកម្ម {len(ad_spans)} កន្លែង ({total:.0f}s) "
                   f"ត្រូវដកចេញពី clip")

    snapped: list[Clip] = []
    for clip in clips:
        result = snap_clip(clip, sentences, video_duration,
                           ad_spans=ad_spans, on_warning=on_warning)
        if result is not None:
            snapped.append(result)

    # **កុំតម្រៀបឡើងវិញ** — `highlights.py` បានដាក់លំដាប់រួចហើយ (តាមការប្រៀបធៀប
    # របស់ LLM មិនមែនតាម score)។ ការតម្រៀបតាម score ទីនេះនឹងបំផ្លាញលំដាប់នោះ
    # ហើយ clip_01 នឹងលែងជា clip ល្អបំផុត (យើងបានជួបវាពិត)។
    return dedupe_overlaps(snapped)


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
