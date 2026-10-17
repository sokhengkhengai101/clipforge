"""ជំហាន 5 — build `.ass` subtitle file ក្នុងមួយ clip.

**`.ass` (Advanced SubStation Alpha) ជាអ្វី?** វាជា format subtitle ដែលគ្រប់គ្រងពណ៌,
font, ទីតាំង និងឥទ្ធិពលបាន (ខុសពី `.srt` ដែលមានតែអត្ថបទ)។ FFmpeg + libass អាច
**burn** វាចូល video ដោយផ្ទាល់។

ចំណុចប្រុងប្រយ័ត្ន ៣ ក្នុង format នេះ៖
  1. **ពណ៌ជា BGR មិនមែន RGB** ហើយសរសេរបញ្ច្រាស: `#FFD23F` -> `&H003FD2FF`
  2. **ពេលវេលាត្រូវរាប់ពីដើម clip** មិនមែនពីដើម video ដើមទេ (ព្រោះ render កាត់ clip ចេញ)
  3. ការបំបែកបន្ទាត់ប្រើ `\\N` (N ធំ) មិនមែន newline ពិត
"""

import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import config
from pipeline.boundaries import ends_sentence
from pipeline.highlights import Clip
from pipeline.transcribe import Transcript, Word

# folder ដែល Windows ដាក់ font
WINDOWS_FONT_DIRS = (
    Path("C:/Windows/Fonts"),
    Path.home() / "AppData/Local/Microsoft/Windows/Fonts",
)

# ពាក្យទូទៅដែលមិនគួរបំលេច (highlight) — គ្មានអត្ថន័យជាក់លាក់
STOPWORDS = {
    "the", "and", "that", "this", "with", "have", "has", "had", "for", "you", "your",
    "are", "was", "were", "but", "not", "they", "them", "then", "than", "what", "when",
    "will", "would", "could", "should", "from", "there", "their", "here", "about",
    "just", "like", "know", "think", "really", "going", "gonna", "want", "said", "says",
    "because", "been", "being", "does", "doing", "done", "some", "much", "more", "most",
    "very", "also", "into", "over", "only", "even", "other", "which", "while", "where",
    "thing", "things", "something", "anything", "everything", "actually", "basically",
}


class CaptionError(RuntimeError):
    """សាងសង់ caption មិនបាន."""


@dataclass
class Cue:
    """អត្ថបទមួយដែលលេចឡើងម្តង (≤ 2 បន្ទាត់)."""

    start: float          # វិនាទីពីដើម clip
    end: float
    lines: list[list[Word]] = field(default_factory=list)

    def text(self) -> str:
        return " ".join(w.word.strip() for line in self.lines for w in line)


# ---------- helper តូចៗ ----------

def ass_color(hex_color: str, alpha: int = 0) -> str:
    """`#FFD23F` -> `&H003FD2FF` (ASS ប្រើ BGR បញ្ច្រាស + alpha ខាងដើម).

    ឧទាហរណ៍: R=FF G=D2 B=3F  ->  &H00 3F D2 FF
                                      B  G  R
    """
    value = hex_color.lstrip("#")
    if len(value) != 6:
        raise CaptionError(f"ពណ៌ត្រូវជា #RRGGBB, ទទួលបាន {hex_color!r}")
    red, green, blue = value[0:2], value[2:4], value[4:6]
    return f"&H{alpha:02X}{blue}{green}{red}".upper()


def ass_time(seconds: float) -> str:
    """0.5 -> `0:00:00.50` ; 125.34 -> `0:02:05.34` (ASS ប្រើ centiseconds)."""
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    whole_seconds = int(seconds % 60)
    centiseconds = int(round((seconds - int(seconds)) * 100))
    if centiseconds == 100:          # ជៀសវាង 1.999 -> .100
        centiseconds = 99
    return f"{hours}:{minutes:02d}:{whole_seconds:02d}.{centiseconds:02d}"


def escape_ass_text(text: str) -> str:
    """លុបតួអក្សរដែល ASS ប្រើជា syntax ចេញពីអត្ថបទធម្មតា."""
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").strip()


def normalise_font_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def find_font_file(family: str) -> Path | None:
    """រក file font តាមឈ្មោះ family (ឧ. "Montserrat ExtraBold").

    libass ប្តូរទៅ font ផ្សេង **ដោយស្ងាត់ៗ** ពេលរកមិនឃើញ ដែលធ្វើឲ្យ caption មិនដូច
    ការរចនាដោយយើងមិនដឹងខ្លួន។ ដូច្នេះយើងពិនិត្យខ្លួនឯង រួចព្រមាន។
    """
    wanted = normalise_font_name(family)
    if not wanted:
        return None
    for folder in WINDOWS_FONT_DIRS:
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.*")):
            if path.suffix.lower() not in (".ttf", ".otf", ".ttc"):
                continue
            if wanted in normalise_font_name(path.stem):
                return path
    return None


def resolve_font(family: str | None = None, fallbacks: tuple[str, ...] | None = None
                 ) -> tuple[str, bool]:
    """ត្រឡប់ (font ដែលត្រូវប្រើ, មែនទេជា font ដែលយើងចង់បាន).

    បើ font ដែលចង់បានគ្មាន យើងព្យាយាម fallback បន្តបន្ទាប់។
    """
    family = family or config.CAPTION_FONT
    fallbacks = fallbacks if fallbacks is not None else config.CAPTION_FONT_FALLBACKS

    if find_font_file(family):
        return family, True
    for candidate in fallbacks:
        if find_font_file(candidate):
            return candidate, False
    return family, False      # គ្មានអ្វីសោះ -> ទុកឈ្មោះដើម, libass នឹងជ្រើសខ្លួនឯង


# ---------- បំបែកពាក្យទៅ cue ----------

def words_in_clip(clip: Clip, transcript: Transcript) -> list[Word]:
    """ពាក្យទាំងអស់ដែលនិយាយក្នុង clip នេះ (ពេលវេលានៅតែជារបស់ video ដើម)."""
    return [
        w for seg in transcript.segments for w in seg.words
        if w.end > clip.start and w.start < clip.end
    ]


def group_into_sentences(words: list[Word]) -> list[list[Word]]:
    """ចែកពាក្យជាប្រយោគ (តាមវណ្ណយុត្តិ) ដើម្បីរៀបចំ cue តាមប្រយោគ.

    ពាក្យទទេត្រូវបោះចោលទីនេះ ដូច្នេះអ្នកហៅមិនចាំបាច់ពិនិត្យទៀត។
    """
    sentences: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        if not word.word.strip():
            continue
        current.append(word)
        if ends_sentence(word.word.strip()):
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return sentences


def wrap_into_cues(
    words: list[Word],
    clip_start: float,
    max_chars: int | None = None,
    max_lines: int | None = None,
    max_words: int | None = None,
) -> list[Cue]:
    """ចែកពាក្យទៅ cue ដែលសមនឹង ≤ max_lines បន្ទាត់ × ≤ max_chars តួ.

    វិធីសាស្ត្រ: បន្ថែមពាក្យទៅបន្ទាត់បច្ចុប្បន្ន។ ពេញបន្ទាត់ -> បន្ទាត់ថ្មី។
    ពេញ max_lines -> cue ថ្មី។ ពេលវេលាដកដោយ `clip_start` ព្រោះ video ដែល render
    ចាប់ផ្តើមពី 0។
    """
    max_chars = max_chars or config.CAPTION_MAX_CHARS_PER_LINE
    max_lines = max_lines or config.CAPTION_MAX_LINES
    max_words = max_words or config.CAPTION_MAX_WORDS_PER_CUE

    cues: list[Cue] = []
    current_lines: list[list[Word]] = [[]]

    def line_length(line: list[Word]) -> int:
        texts = [w.word.strip() for w in line]
        return sum(len(t) for t in texts) + max(0, len(texts) - 1)   # + ដកឃ្លា

    def flush() -> None:
        lines = [line for line in current_lines if line]
        if not lines:
            return
        first_word = lines[0][0]
        last_word = lines[-1][-1]
        start = first_word.start - clip_start
        end = last_word.end - clip_start
        if end <= start:                 # ពាក្យ 0 វិនាទី (Whisper quirk) -> ឲ្យឃើញ 0.5s
            end = start + 0.5
        cues.append(Cue(start=max(0.0, start), end=end, lines=lines))

    def add_word(word: Word) -> None:
        """ដាក់ពាក្យមួយ — ចុះបន្ទាត់ថ្មី ឬបើក cue ថ្មីពេលពេញ ឬពេលស្ងាត់យូរ."""
        nonlocal current_lines
        # ភាពស្ងាត់វែង -> បិទ cue មុន កុំឲ្យអក្សរកកនៅលើអេក្រង់ពេលគ្មានសំឡេង
        filled = [line for line in current_lines if line]
        if filled and word.start - filled[-1][-1].end > config.CAPTION_PAUSE_SEC:
            flush()
            current_lines = [[word]]
            return

        candidate = current_lines[-1] + [word]
        if line_length(candidate) <= max_chars or not current_lines[-1]:
            current_lines[-1].append(word)
        elif len(current_lines) < max_lines:
            current_lines.append([word])
        else:
            flush()
            current_lines = [[word]]

    def word_count() -> int:
        return sum(len(line) for line in current_lines)

    def unhook_trailing() -> list[Word]:
        """ដកពាក្យភ្ជាប់នៅចុង cue ចេញ រួចត្រឡប់វាសម្រាប់ cue បន្ទាប់.

        ដកបានច្រើនបំផុត ២ ពាក្យ ហើយ cue ត្រូវនៅសល់យ៉ាងតិច ២ ពាក្យ — បើមិនដូច្នោះ
        យើងប្តូរបញ្ហាមួយ (ចប់ខុស) ទៅបញ្ហាមួយទៀត (cue ១ ពាក្យភ្លឹបភ្លែត)។
        """
        carried: list[Word] = []
        while len(carried) < 2:
            filled = [line for line in current_lines if line]
            if not filled or sum(len(line) for line in filled) <= 2:
                break
            if not dangling(filled[-1][-1]):
                break
            carried.insert(0, filled[-1].pop())
            if not current_lines[-1] and len(current_lines) > 1:
                current_lines.pop()
        return carried

    def dangling(word: Word) -> bool:
        """ពាក្យនេះភ្ជាប់ទៅពាក្យបន្ទាប់ឬទេ ("the", "into", "is")?

        cue មិនគួរចប់ដោយពាក្យបែបនេះទេ — អ្នកមើលឃើញ "...behind the" រួចត្រូវ
        រង់ចាំ cue បន្ទាប់ទើបដឹងថា "the" នោះជាអ្វី។
        """
        bare = re.sub(r"[^\w']", "", word.word.strip().lower())
        return bare in config.CAPTION_NO_BREAK_AFTER

    def fits_whole(sentence: list[Word]) -> bool:
        """ប្រយោគនេះសមនឹងទីវ៉ាងដែលនៅសល់ក្នុង cue បច្ចុប្បន្នឬទេ (សាកដាក់មើល)."""
        if word_count() + len(sentence) > max_words:
            return False
        lines = [list(line) for line in current_lines]
        for word in sentence:
            if line_length(lines[-1] + [word]) <= max_chars or not lines[-1]:
                lines[-1].append(word)
            elif len(lines) < max_lines:
                lines.append([word])
            else:
                return False
        return True

    def cues_needed(sentence: list[Word]) -> int:
        """ប្រយោគនេះត្រូវការ cue ប៉ុន្មាន បើដាក់ចាប់ពី cue ទទេ."""
        count, lines, words = 1, [[]], 0
        for word in sentence:
            if words >= max_words:
                count += 1
                lines, words = [[word]], 1
                continue
            words += 1
            if line_length(lines[-1] + [word]) <= max_chars or not lines[-1]:
                lines[-1].append(word)
            elif len(lines) < max_lines:
                lines.append([word])
            else:
                count += 1
                lines, words = [[word]], 1
        return count

    # **រៀបចំតាមប្រយោគ មិនមែនតាមពាក្យ**។ បើយើងដាក់ពាក្យម្តងមួយៗ កន្ទុយប្រយោគមុន
    # អាចទៅបើក cue ថ្មី ហើយអ្នកមើលឃើញ "APPS. I THINK IN THE FUTURE," (យើងឃើញពិត)។
    for sentence in group_into_sentences(words):
        if any(current_lines) and not fits_whole(sentence):
            flush()
            current_lines = [[]]

        if fits_whole(sentence):
            for word in sentence:
                add_word(word)
            continue

        # ប្រយោគវែងជាង cue មួយ -> **ចែកឲ្យស្មើគ្នា**។ ការបំពេញបែប greedy ទុកពាក្យ
        # តែមួយនៅ cue ចុងក្រោយ ("APPS.") ដែលភ្លឹបភ្លែតលើអេក្រង់។
        total = sum(len(w.word.strip()) + 1 for w in sentence)
        needed = cues_needed(sentence)
        target = total / needed
        words_per_cue = math.ceil(len(sentence) / needed)
        for index, word in enumerate(sentence):
            add_word(word)
            room_left = index < len(sentence) - 1
            full = (sum(line_length(l) for l in current_lines) >= target
                    or word_count() >= words_per_cue)
            if room_left and full:
                # cue មិនគួរចប់ដោយពាក្យភ្ជាប់ទេ — ទម្លាក់វាទៅ cue បន្ទាប់វិញ
                # ("...behind the | operation" -> "...behind | the operation")
                carried = unhook_trailing()
                flush()
                current_lines = [[]]
                for spare in carried:
                    add_word(spare)

    flush()

    # cue មិនត្រូវត្រួតគ្នា (ធ្វើឲ្យ libass បង្ហាញពីរជាន់)
    for earlier, later in zip(cues, cues[1:]):
        if earlier.end > later.start:
            earlier.end = later.start

    # cue ខ្លីពេកអានមិនទាន់ -> ពន្យារដល់ cue បន្ទាប់ (មិនត្រួតគ្នា)
    for index, cue in enumerate(cues):
        if cue.end - cue.start >= config.CAPTION_MIN_CUE_SEC:
            continue
        wanted = cue.start + config.CAPTION_MIN_CUE_SEC
        limit = cues[index + 1].start if index + 1 < len(cues) else wanted
        cue.end = max(cue.end, min(wanted, limit))

    return cues


# ---------- keyword highlight ----------

def pick_keywords(cue: Cue, max_keywords: int | None = None, min_length: int = 5) -> set[str]:
    """ជ្រើសពាក្យដែលគួរបំលេចជាពណ៌លឿងក្នុង cue នេះ.

    ច្បាប់សាមញ្ញ និងអាចទាយទុកជាមុន: ពាក្យវែង (≥ 5 តួ) ដែលមិនមែន stopword,
    យកពាក្យវែងបំផុត max_keywords ។ (Phase 1 អាចប្រើ LLM ជ្រើសឲ្យឆ្លាតជាង។)
    """
    max_keywords = config.CAPTION_KEYWORDS_PER_CUE if max_keywords is None else max_keywords
    candidates: list[str] = []
    for line in cue.lines:
        for word in line:
            bare = re.sub(r"[^\w']", "", word.word.strip().lower())
            if len(bare) >= min_length and bare not in STOPWORDS:
                candidates.append(bare)

    candidates.sort(key=len, reverse=True)
    return set(candidates[:max_keywords])


def cue_to_dialogue_text(cue: Cue, keywords: set[str], keyword_color: str) -> str:
    """បម្លែង cue ទៅអត្ថបទ ASS មួយបន្ទាត់ (ប្រើ `\\N` បំបែកបន្ទាត់).

    ពាក្យ keyword ត្រូវព័ទ្ធដោយ override tag:
        {\\c&H003FD2FF&}skills{\\c&H00FFFFFF&}
    `\\c` កំណត់ពណ៌អត្ថបទ; យើងត្រូវដាក់ពណ៌ដើមវិញក្រោយពាក្យនោះ។
    """
    normal = ass_color(config.CAPTION_TEXT_COLOR)
    highlight = ass_color(keyword_color)

    # បំលេចតែ **ដំណាក់ទីមួយ** នៃពាក្យនីមួយៗ។ បើមិនដូច្នោះ "skills, skills, skills"
    # ក្លាយជាលឿងទាំងអស់ ហើយការបំលេចអស់អត្ថន័យ (bug ពិតដែលយើងបានឃើញ)។
    remaining = set(keywords)

    rendered_lines: list[str] = []
    for line in cue.lines:
        parts: list[str] = []
        for word in line:
            text = escape_ass_text(word.word.strip())
            bare = re.sub(r"[^\w']", "", text.lower())
            if config.CAPTION_UPPERCASE:
                text = text.upper()        # style short-form: អានលឿនពេលរំកិល
            if bare in remaining:
                remaining.discard(bare)
                # ទម្រង់ត្រឹមត្រូវ: {\c&HBBGGRR&} — `&` បិទតម្លៃពណ៌
                parts.append(f"{{\\c{highlight}&}}{text}{{\\c{normal}&}}")
            else:
                parts.append(text)
        rendered_lines.append(" ".join(parts))

    return "\\N".join(rendered_lines)


# ---------- ទីតាំង និង event ----------

def anchor_for(cue: Cue, clip_start: float, segments: list | None) -> str:
    """cue នេះគួរនៅកណ្តាលអេក្រង់ (split) ឬទីតាំងដើម (normal)?

    OpusClip ដាក់អក្សរត្រង់ស្នាមរវាងផ្ទាំងពីរ ប៉ុន្តែតែ**ពេលមាន** split ប៉ុណ្ណោះ។
    យើងប្រៀបធៀបពេលកណ្តាលនៃ cue នឹងផែនការ layout។
    """
    if not segments:
        return "normal"
    middle = clip_start + (cue.start + cue.end) / 2
    for segment in segments:
        if segment.start <= middle < segment.end:
            return "split" if segment.layout.kind == "split" else "normal"
    return "normal"


def line_positions(count: int, anchor: str, margin_v: int | None = None) -> list[float]:
    """y កណ្តាលនៃបន្ទាត់នីមួយៗ (ពីលើទៅក្រោម).

    libass **មិនអើពើ** `LineSpacing` ដូច្នេះយើងដាក់បន្ទាត់នីមួយៗដោយ `\\pos`។
    - `split`  -> ប្លុកនៅកណ្តាលត្រង់ស្នាម (កម្ពស់ / 2)
    - `normal` -> បាតប្លុកនៅ កម្ពស់ − margin (ទីតាំង lower third ដើម)
    """
    gap = config.CAPTION_LINE_GAP
    margin_v = config.CAPTION_MARGIN_V if margin_v is None else margin_v
    span = (count - 1) * gap

    if anchor == "split":
        first = config.OUT_HEIGHT / 2 - span / 2
    else:
        bottom = config.OUT_HEIGHT - margin_v
        first = bottom - span - config.CAPTION_FONT_SIZE / 2

    return [first + index * gap for index in range(count)]


def word_intervals(cue: Cue, clip_start: float = 0.0) -> list[tuple[float, float]]:
    """ចន្លោះពេលសម្រាប់ពាក្យនីមួយៗ — ពាក្យមួយរស់រហូតដល់ពាក្យបន្ទាប់ចាប់ផ្តើម.

    ការប្រើ `word.end` ទុកចន្លោះតូចៗដែលគ្មានពាក្យណាបំលេច ហើយវាភ្លឹបភ្លែត។

    **ពាក្យផ្ទុកពេលដាច់ខាត តែ cue ផ្ទុកពេលធៀបនឹងដើម clip** ដូច្នេះត្រូវដក `clip_start`។
    ការភ្លេចវាផ្តល់ `Dialogue: 0,0:08:20.00,0:00:03.00` (test ចាប់បាន)។
    """
    words = [w for line in cue.lines for w in line]
    intervals: list[tuple[float, float]] = []
    for index, word in enumerate(words):
        start = min(max(cue.start, word.start - clip_start), cue.end)
        if index + 1 < len(words):
            end = max(start, words[index + 1].start - clip_start)
        else:
            end = cue.end
        if end - start < config.CAPTION_MIN_WORD_SEC:
            end = start + config.CAPTION_MIN_WORD_SEC
        # **កាត់ត្រឹម `cue.end` ជានិច្ច** រួមទាំងពាក្យចុងក្រោយ។ ច្បាប់ប្រវែងអប្បបរមា
        # ធ្លាប់រុញពាក្យចុងក្រោយហួស cue ទៅត្រួត cue បន្ទាប់ 0.1s ហើយ caption ពីរ
        # លេចព្រមគ្នាលើអេក្រង់ (យើងឃើញវាក្នុង clip_02 នាទី 30.02)។
        intervals.append((start, min(end, cue.end)))
    return intervals


def display_word(text: str) -> str:
    """អត្ថបទដែលបង្ហាញលើអេក្រង់ — លុបវណ្ណយុត្តិ តែរក្សា ' និង - ក្នុងពាក្យ.

    `ends_sentence()` និងការរៀបចំ cue នៅតែប្រើអត្ថបទ**ដើម** ដូច្នេះការលុបនេះ
    ប៉ះពាល់តែអ្វីដែលភ្នែកឃើញ។
    """
    if not config.CAPTION_STRIP_PUNCTUATION:
        return text
    cleaned = re.sub(r"[^\w'\-]", "", text)
    return cleaned.strip("-'") or text


def render_line(line: list[Word], active: Word | None) -> str:
    """អត្ថបទបន្ទាត់មួយ ដែលពាក្យសកម្មលឿង និងពង្រីកបញ្ឈរបន្តិច.

    **ពង្រីកបញ្ឈរ (`\\fscy`) មិនមែនទាំងទទឹង (`\\fs`)**។ `\\fs` ប្តូរទទឹងបន្ទាត់ ហើយ
    ដោយបន្ទាត់ត្រូវដាក់កណ្តាល ពាក្យឯទៀតលោតឆ្វេង-ស្តាំរាល់ពេលការបំលេចផ្លាស់ទី។
    វាស់រួច: `\\fs` -> ទទឹង 692 ទៅ 708/712px; `\\fscy` -> 692px ដដែល (កម្ពស់ 51->55)។
    """
    normal_colour = ass_color(config.CAPTION_TEXT_COLOR)
    active_colour = ass_color(config.CAPTION_KEYWORD_COLOR)
    scale = int(round(config.CAPTION_ACTIVE_SCALE * 100))
    grow = f"\\fscy{scale}" if scale != 100 else ""
    shrink = "\\fscy100" if scale != 100 else ""

    parts: list[str] = []
    for word in line:
        text = display_word(escape_ass_text(word.word.strip()))
        if config.CAPTION_UPPERCASE:
            text = text.upper()
        if active is not None and word is active:
            parts.append(f"{{{grow}\\c{active_colour}&}}{text}"
                         f"{{{shrink}\\c{normal_colour}&}}")
        else:
            parts.append(text)
    return " ".join(parts)


def dialogue(start: float, end: float, y: float, text: str) -> str:
    """Dialogue មួយបន្ទាត់ ដាក់ទីតាំងដោយ `\\an5\\pos` (an5 = កណ្តាលទាំងផ្ដេកនិងបញ្ឈរ)."""
    x = config.OUT_WIDTH / 2
    return (f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,"
            f"{{\\an5\\pos({x:.0f},{y:.0f})}}{text}")


def cue_events(cue: Cue, anchor: str = "normal", margin_v: int | None = None,
               clip_start: float = 0.0) -> list[str]:
    """Dialogue ទាំងអស់សម្រាប់ cue មួយ.

    ពេលបើកការបំលេចតាមសំឡេង យើងបញ្ចេញបន្ទាត់ទាំងអស់ឡើងវិញក្នុងមួយចន្លោះពេលពាក្យ
    (ពាក្យ × បន្ទាត់ event) ព្រោះបន្ទាត់ផ្សេងត្រូវតែនៅលើអេក្រង់ដដែល។
    """
    ys = line_positions(len(cue.lines), anchor, margin_v)

    if not config.CAPTION_WORD_HIGHLIGHT:
        keywords = pick_keywords(cue)
        events = []
        for line, y in zip(cue.lines, ys):
            active = next((w for w in line
                           if re.sub(r"[^\w']", "", w.word.strip().lower()) in keywords), None)
            events.append(dialogue(cue.start, cue.end, y, render_line(line, active)))
        return events

    words = [w for line in cue.lines for w in line]
    events = []
    for word, (start, end) in zip(words, word_intervals(cue, clip_start)):
        # ពាក្យចុងក្រោយអាចចាប់ផ្តើមត្រង់ចុង cue (Whisper ឲ្យពេលមិនច្បាស់) ->
        # ចន្លោះ 0 វិនាទី។ Event បែបនេះគ្មានអ្វីបង្ហាញ ហើយជាសំរាមក្នុង .ass។
        if end - start < 0.02:
            continue
        for line, y in zip(cue.lines, ys):
            events.append(dialogue(start, end, y, render_line(line, word)))

    if not events:        # គ្រប់ចន្លោះខ្លីពេក -> បង្ហាញ cue ដោយគ្មានការបំលេច
        return [dialogue(cue.start, cue.end, y, render_line(line, None))
                for line, y in zip(cue.lines, ys)]
    return events


# ---------- ASS file ----------

def ass_header(font: str, margin_v: int | None = None) -> str:
    """ផ្នែកដើមនៃ `.ass`: resolution, style (font, ពណ៌, ទីតាំង).

    `margin_v` = ចម្ងាយពីបាតរូប។ ក្នុង split screen យើងលើកអក្សរឡើងជិតស្នាម
    រវាងផ្ទាំងពីរ ជំនួសការទុកវានៅ lower third។
    """
    primary = ass_color(config.CAPTION_TEXT_COLOR)
    outline = ass_color(config.CAPTION_OUTLINE_COLOR)
    margin_v = config.CAPTION_MARGIN_V if margin_v is None else margin_v
    # SecondaryColour មិនប្រើ តែ format តម្រូវឲ្យមាន
    return "\n".join([
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {config.OUT_WIDTH}",
        f"PlayResY: {config.OUT_HEIGHT}",
        "WrapStyle: 2",          # 2 = កុំ wrap ដោយខ្លួនឯង, យើងគ្រប់គ្រងដោយ \\N
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, "
        "BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, "
        "BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        (
            f"Style: Default,{font},{config.CAPTION_FONT_SIZE},{primary},{primary},"
            f"{outline},&H80000000,-1,0,0,0,100,100,0,0,1,"
            f"{config.CAPTION_OUTLINE},{config.CAPTION_SHADOW},2,"
            f"{config.CAPTION_MARGIN_X},{config.CAPTION_MARGIN_X},{margin_v},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])


def build_ass(
    clip: Clip,
    transcript: Transcript,
    out_path: Path,
    *,
    font: str | None = None,
    margin_v: int | None = None,
    segments: list | None = None,
) -> Path:
    """សរសេរ `.ass` សម្រាប់ clip មួយ. ត្រឡប់ path។

    `segments` = ផែនការ layout ពី `reframe.plan_clip()`។ Caption ផ្លាស់ទីទៅកណ្តាល
    អេក្រង់ខណៈ shot ជា split រួចត្រឡប់មកទីតាំងដើមវិញ — ក្នុងមួយ cue មិនមែនក្នុងមួយ clip។
    """
    words = words_in_clip(clip, transcript)
    if not words:
        raise CaptionError(f"'{clip.title}' គ្មានពាក្យក្នុងចន្លោះ "
                           f"{clip.start:.1f}-{clip.end:.1f}s")

    cues = wrap_into_cues(words, clip.start)
    chosen_font = font or resolve_font()[0]

    lines = [ass_header(chosen_font, margin_v)]
    for cue in cues:
        anchor = anchor_for(cue, clip.start, segments)
        lines.extend(cue_events(cue, anchor, margin_v, clip_start=clip.start))

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return out_path


def build_all_captions(
    clips: list[Clip],
    transcript: Transcript,
    out_dir: Path,
    *,
    font: str | None = None,
    margins: list[int | None] | None = None,
    plans: list[list] | None = None,
) -> list[Path]:
    """សរសេរ `.ass` មួយក្នុងមួយ clip ទៅ `out_dir/clip_01.ass` ...។"""
    out_dir = Path(out_dir)
    paths: list[Path] = []
    for index, clip in enumerate(clips, start=1):
        margin = margins[index - 1] if margins is not None and index <= len(margins) else None
        segments = plans[index - 1] if plans is not None and index <= len(plans) else None
        paths.append(build_ass(clip, transcript, out_dir / f"clip_{index:02d}.ass",
                               font=font, margin_v=margin, segments=segments))
    return paths


# ---------- QA (checklist §12) ----------

def check_cues(cues: list[Cue], anchor: str = "normal",
               margin_v: int | None = None) -> list[str]:
    """ពិនិត្យ cue ទល់នឹងច្បាប់ caption. ត្រឡប់បញ្ជីបញ្ហា (ទទេ = ស្អាត).

    នេះជាការត្រួតពិនិត្យ **លើលទ្ធផលពិត** មិនមែន unit test ទេ — វារត់ក្នុង
    pipeline ដូច្នេះការថយក្រោយលេចឡើងភ្លាម ជាជាងរកឃើញនៅពេលមើលវីដេអូ។
    """
    problems: list[str] = []
    if not cues:
        return problems

    # ១. ទំហំ: ពាក្យ / តួអក្សរ / បន្ទាត់
    for index, cue in enumerate(cues):
        words = sum(len(line) for line in cue.lines)
        if words > config.CAPTION_MAX_WORDS_PER_CUE:
            problems.append(f"cue {index}: {words} ពាក្យ (ដែន {config.CAPTION_MAX_WORDS_PER_CUE})")
        if len(cue.lines) > config.CAPTION_MAX_LINES:
            problems.append(f"cue {index}: {len(cue.lines)} បន្ទាត់ (ដែន {config.CAPTION_MAX_LINES})")
        for line in cue.lines:
            length = len(" ".join(display_word(w.word) for w in line))
            if length > config.CAPTION_MAX_CHARS_PER_LINE:
                problems.append(f"cue {index}: បន្ទាត់ {length} តួ "
                                f"(ដែន {config.CAPTION_MAX_CHARS_PER_LINE})")

    # ២. ពេលវេលា: ប្រវែងអប្បបរមា និងការត្រួតគ្នា
    for index, cue in enumerate(cues):
        if cue.end - cue.start < config.CAPTION_MIN_CUE_SEC:
            problems.append(f"cue {index}: លេចត្រឹម {cue.end - cue.start:.2f}s "
                            f"(ដែន {config.CAPTION_MIN_CUE_SEC}s)")
    for index, (earlier, later) in enumerate(zip(cues, cues[1:])):
        if earlier.end > later.start + 0.001:
            problems.append(f"cue {index}/{index + 1}: ត្រួតគ្នា "
                            f"{earlier.end - later.start:.2f}s")

    # ៣. ការកាត់ត្រង់ពាក្យភ្ជាប់ (ច្បាប់ §3)
    for index, cue in enumerate(cues[:-1]):
        last = display_word(cue.lines[-1][-1].word).lower()
        if last in config.CAPTION_NO_BREAK_AFTER:
            problems.append(f"cue {index}: ចប់ដោយ {last!r}")

    # ៤. សមាមាត្រពាក្យបំលេច
    total = sum(len(line) for cue in cues for line in cue.lines)
    highlighted = sum(len(pick_keywords(cue)) for cue in cues)
    if total:
        ratio = highlighted / total
        if not (config.CAPTION_HIGHLIGHT_MIN <= ratio <= config.CAPTION_HIGHLIGHT_MAX):
            problems.append(f"ការបំលេច {100 * ratio:.0f}% (ដែន "
                            f"{100 * config.CAPTION_HIGHLIGHT_MIN:.0f}-"
                            f"{100 * config.CAPTION_HIGHLIGHT_MAX:.0f}%)")

    # ៥. តំបន់សុវត្ថិភាព (ប៊ូតុងរបស់ platform)
    most_lines = max(len(cue.lines) for cue in cues)
    ys = line_positions(most_lines, anchor, margin_v)
    half = config.CAPTION_FONT_SIZE / 2
    top_limit = config.OUT_HEIGHT * config.CAPTION_SAFE_TOP
    bottom_limit = config.OUT_HEIGHT * (1 - config.CAPTION_SAFE_BOTTOM)
    if ys and ys[0] - half < top_limit:
        problems.append(f"អក្សរឡើងដល់ y={ys[0] - half:.0f} (ដែនលើ {top_limit:.0f})")
    if ys and ys[-1] + half > bottom_limit:
        problems.append(f"អក្សរចុះដល់ y={ys[-1] + half:.0f} (ដែនក្រោម {bottom_limit:.0f})")

    return problems
