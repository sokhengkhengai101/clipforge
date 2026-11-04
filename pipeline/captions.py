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
    # ឈ្មោះ file មិនតែងតែជាឈ្មោះ font ទេ ("Arial Black" = ariblk.ttf) — Windows ទុកឈ្មោះពិតក្នុង registry
    return registry_fonts().get(wanted)


def registry_fonts() -> dict[str, Path]:
    """{ឈ្មោះ font (normalise): file} ពី registry Fonts របស់ Windows (ម៉ាស៊ីន + អ្នកប្រើ).

    ឧ. "Arial Black (TrueType)" -> ariblk.ttf; collection "Cambria & Cambria Math" ចែកជាពីរ.
    """
    try:
        import winreg
    except ImportError:          # មិនមែន Windows
        return {}
    found: dict[str, Path] = {}
    keys = ((winreg.HKEY_LOCAL_MACHINE, WINDOWS_FONT_DIRS[0]), (winreg.HKEY_CURRENT_USER, WINDOWS_FONT_DIRS[1]))
    for root, folder in keys:
        try:
            key = winreg.OpenKey(root, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
        except OSError:
            continue
        with key:
            index = 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(key, index)
                except OSError:
                    break
                index += 1
                path = Path(value) if Path(value).is_absolute() else folder / value
                for part in re.sub(r"\s*\((TrueType|OpenType)\)$", "", name).split(" & "):
                    found.setdefault(normalise_font_name(part), path)
    return found


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

# layout ច្រើនផ្ទាំង: caption នៅលើស្នាម ជាកន្លែងតែមួយដែលមិនបាំងមុខនរណា
SEAM_LAYOUTS = ("split", "three", "four", "screen1", "screen2")
# caption នៅលើស្នាមផ្ដេកចុងក្រោយ (split នៅកណ្តាលកម្ពស់) — screen = រវាង slide និងមនុស្ស
LAST_SEAM_LAYOUTS = ("three", "four", "screen1", "screen2")


def anchor_for(cue: Cue, clip_start: float, segments: list | None) -> str:
    """cue នេះនៅលើស្នាមរបស់ផ្ទាំង (split / three / four) ឬទីតាំងដើម (normal)?

    OpusClip ដាក់អក្សរត្រង់ស្នាមរវាងផ្ទាំង ប៉ុន្តែតែ**ពេលមាន**ផ្ទាំងច្រើនប៉ុណ្ណោះ។
    យើងប្រៀបធៀបពេលកណ្តាលនៃ cue នឹងផែនការ layout — **តាម shot នីមួយៗ** មិនមែនតាម
    layout ភាគច្រើនរបស់ clip ទេ: ច្បាប់ចាស់នោះរុញ caption របស់ shot មុខម្នាក់ឡើងទៅជិតមាត់
    ក្នុង clip ដែលភាគច្រើនជា split, ហើយទុក caption របស់ shot three នៅ lower third ពីលើមុខ
    មនុស្សក្នុងផ្ទាំងតូច (វាស់លើ Taylor_Tomlinson clip 1, 2, 4).
    """
    # --caption-position top/middle/bottom = កន្លែងតែមួយសម្រាប់គ្រប់ layout
    if not segments or config.CAPTION_POSITION != "auto":
        return "normal"
    middle = clip_start + (cue.start + cue.end) / 2
    for segment in segments:
        if segment.start <= middle < segment.end:
            return segment.layout.kind if segment.layout.kind in SEAM_LAYOUTS else "normal"
    return "normal"


def last_seam(kind: str) -> int | None:
    """y នៃស្នាមផ្ដេកចុងក្រោយរបស់ layout (ពី `reframe.panel_rects`, ធរណីមាត្រតែមួយកន្លែង).

    `None` លើ 16:9 (ផ្ទាំងនៅចំហៀងគ្នា គ្មានស្នាមផ្ដេក) ឬ layout មួយផ្ទាំង.
    import នៅទីនេះ: reframe ធ្ងន់ ហើយ server import captions ពេលចាប់ផ្តើម.
    """
    from pipeline.reframe import panel_rects

    if config.SPLIT_DIRECTION != "vertical":
        return None
    seams = {y for _, y, _, _ in panel_rects(kind) if y > 0}
    return max(seams) if seams else None


def line_positions(count: int, anchor: str, margin_v: int | None = None) -> list[float]:
    """y កណ្តាលនៃបន្ទាត់នីមួយៗ (ពីលើទៅក្រោម).

    libass **មិនអើពើ** `LineSpacing` ដូច្នេះយើងដាក់បន្ទាត់នីមួយៗដោយ `\\pos`។
    - `split`  -> ប្លុកនៅកណ្តាលត្រង់ស្នាម (កម្ពស់ / 2)
    - `three` / `four` -> ប្លុកនៅកណ្តាលលើស្នាមផ្ដេកចុងក្រោយ (three: 1280 លើ 1920) តាមចំនួន
      បន្ទាត់ពិត — margin ចាស់គិតថា ៣ បន្ទាត់ជានិច្ច ហើយ cue ២ បន្ទាត់ធ្លាក់ក្រោមស្នាម ~100 px
    - `normal` -> បាតប្លុកនៅ កម្ពស់ − margin (ទីតាំង lower third ដើម)
    """
    gap = config.CAPTION_LINE_GAP
    margin_v = config.CAPTION_MARGIN_V if margin_v is None else margin_v
    span = (count - 1) * gap
    seam = last_seam(anchor) if anchor in LAST_SEAM_LAYOUTS else None

    if anchor == "split":
        first = config.OUT_HEIGHT / 2 - span / 2
    elif seam is not None:
        first = seam - span / 2
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


def keyword_colours(cue: Cue, index: int) -> dict[int, str]:
    """AI keywords highlighter: {id(word): ពណ៌} សម្រាប់ពាក្យសំខាន់ក្នុង cue — ពណ៌ឆ្លាស់តាម cue.

    ឧ. cue ទី ០ = ពណ៌ទី ១, cue ទី ១ = ពណ៌ទី ២. បិទ = {}.
    """
    if not config.CAPTION_KEYWORD_HIGHLIGHT:
        return {}
    keywords = pick_keywords(cue)
    colour = config.CAPTION_KEYWORD_COLORS[index % 2]
    return {id(word): colour for line in cue.lines for word in line
            if re.sub(r"[^\w']", "", word.word.strip().lower()) in keywords}


def render_line(line: list[Word], active: Word | None, marked: dict[int, str] | None = None) -> str:
    """អត្ថបទបន្ទាត់មួយ ដែលពាក្យសកម្មលឿង និងពង្រីកបញ្ឈរបន្តិច.

    **ពង្រីកបញ្ឈរ (`\\fscy`) មិនមែនទាំងទទឹង (`\\fs`)**។ `\\fs` ប្តូរទទឹងបន្ទាត់ ហើយ
    ដោយបន្ទាត់ត្រូវដាក់កណ្តាល ពាក្យឯទៀតលោតឆ្វេង-ស្តាំរាល់ពេលការបំលេចផ្លាស់ទី។
    វាស់រួច: `\\fs` -> ទទឹង 692 ទៅ 708/712px; `\\fscy` -> 692px ដដែល (កម្ពស់ 51->55)។
    """
    from pipeline import caption_fx

    normal_colour = ass_color(config.CAPTION_TEXT_COLOR)
    active_colour = ass_color(caption_fx.active_word_colour())
    # tag របស់ពាក្យកំពុងនិយាយ (pop = ពង្រីកបញ្ឈរ, scale, underline, box ...) និងពាក្យផ្សេង (blur, focus)
    grow, shrink = caption_fx.active_word_tags()
    dim, undim = caption_fx.other_word_tags() if active is not None else ("", "")

    # baby_steps: ពាក្យដែលនិយាយក្រោយពាក្យសកម្ម មើលមិនឃើញ (តែនៅតែកាន់កន្លែង)
    hide_after = active.start if active is not None and caption_fx.hides_future_words() else None

    parts: list[str] = []
    for word in line:
        text = display_word(escape_ass_text(word.word.strip()))
        if config.CAPTION_UPPERCASE:
            text = text.upper()
        if hide_after is not None and word.start > hide_after:
            parts.append(f"{{\\alpha&HFF&}}{text}{{\\alpha&H00&}}")
        elif active is not None and word is active:
            parts.append(f"{{{grow}\\c{active_colour}&}}{text}"
                         f"{{{shrink}\\c{normal_colour}&}}")
        elif marked and id(word) in marked:
            # ពាក្យសំខាន់ (keyword highlighter) — ពណ៌របស់វាពេលមិនមែនជាពាក្យកំពុងនិយាយ
            parts.append(f"{{{dim}\\c{ass_color(marked[id(word)])}&}}{text}{{{undim}\\c{normal_colour}&}}")
        elif dim:
            parts.append(f"{{{dim}}}{text}{{{undim}}}")
        else:
            parts.append(text)
    return " ".join(parts)


def box_line(line: list[Word], active: Word | None) -> str:
    """អត្ថបទដដែលសម្រាប់ layer ប្រអប់ (style `Box`, BorderStyle 3): អក្សរ និងស្រមោលថ្លា ហើយប្រអប់
    របស់ពាក្យនីមួយៗថ្លា (`\\3a&HFF&`) លើកលែងពាក្យកំពុងនិយាយ — ដូច្នេះប្រអប់នៅពីក្រោយពាក្យនោះតែមួយ.
    ពាក្យដូចគ្នា font ដូចគ្នា = ទទឹងដូចគ្នានឹង layer អក្សរ (វាស់ផ្ទៀងផ្ទាត់ក្នុង scratchpad មុនសាងសង់)."""
    from pipeline import caption_fx
    # alpha របស់ប្រអប់ (highlighter ថ្លា 0x60) — `\3a` ជំនួស alpha របស់ style ដូច្នេះត្រូវដាក់វានៅទីនេះ;
    # ប្រអប់បិទវិញ**មុន**ដកឃ្លា បើមិនដូច្នោះវាគ្របដកឃ្លាផង (វាស់: ទទឹង 244 ធៀប 225 px)
    shown = f"{{\\3a&H{caption_fx.box_alpha():02X}&}}"
    parts = []
    for word in line:
        text = display_word(escape_ass_text(word.word.strip()))
        if config.CAPTION_UPPERCASE:
            text = text.upper()
        parts.append(f"{shown}{text}{{\\3a&HFF&}}" if active is not None and word is active else text)
    return "{\\1a&HFF&\\4a&HFF&\\3a&HFF&}" + " ".join(parts)


def intro_tags(x: float, y: float, offset_ms: int) -> str:
    """Tag ទីតាំង + ចលនាលេច — ឥឡូវនៅ `pipeline/caption_fx.py` (ចលនាច្រើនពេកសម្រាប់ file នេះ)."""
    from pipeline import caption_fx
    return caption_fx.intro_tags(x, y, offset_ms)


def dialogue(start: float, end: float, y: float, text: str, offset_ms: int | None = None,
             layer: int = 0, style: str = "Default", cue_ms: int | None = None, dx: float = 0) -> str:
    """Dialogue មួយបន្ទាត់ ដាក់ទីតាំងដោយ `\\an5\\pos` (an5 = កណ្តាលទាំងផ្ដេកនិងបញ្ឈរ).

    `offset_ms` = event នេះចាប់ផ្តើមប៉ុន្មាន ms ក្រោយ cue (None = គ្មានចលនាលេច).
    `cue_ms` = រយៈពេល cue ទាំងមូល សម្រាប់ចលនាដែលរត់ពេញ cue (breathe, earthquake ...).
    `dx` = រំកិលផ្ដេកជា px (ស្រទាប់ពណ៌របស់ glitch).
    """
    from pipeline import caption_fx
    x = config.OUT_WIDTH / 2 + dx
    tags = intro_tags(x, y, offset_ms) if offset_ms is not None else f"\\an5\\pos({x:.0f},{y:.0f})"
    if offset_ms is not None and cue_ms:
        tags += caption_fx.hold_tags(offset_ms, cue_ms)
    extra = shadow_tags() if style == "Default" else ""      # ប្រអប់គ្មានស្រមោល
    return (f"Dialogue: {layer},{ass_time(start)},{ass_time(end)},{style},,0,0,0,,"
            f"{{{tags}{extra}}}{text}")


def plain_line(line: list[Word], prefix: str) -> str:
    """បន្ទាត់ដោយគ្មានពណ៌ពាក្យ, មានតែ `prefix` (ឧ. `\\1a&HFF&` = លាក់អក្សរ ទុកតែប្រអប់)."""
    parts = []
    for word in line:
        text = display_word(escape_ass_text(word.word.strip()))
        parts.append(text.upper() if config.CAPTION_UPPERCASE else text)
    return f"{{{prefix}}}" + " ".join(parts)


def line_events(start: float, end: float, y: float, line: list[Word], active: Word | None,
                marked: dict[int, str], offset_ms: int, cue_ms: int | None = None) -> list[str]:
    """Dialogue របស់បន្ទាត់មួយ: ស្រទាប់ខាងក្រោម (layer 0) + អក្សរ (layer 1) ពេលចលនាត្រូវការ.

    box / highlighter = ប្រអប់ពីក្រោយពាក្យកំពុងនិយាយ; with_backdrop = ប្រអប់ពីក្រោយបន្ទាត់ទាំងមូល
    (style `Backdrop`, BorderStyle 4); glitch = ស្រទាប់ក្រហម និងខៀវ រំកិលឆ្វេង/ស្តាំ.
    """
    from pipeline import caption_fx
    timing = {"offset_ms": offset_ms, "cue_ms": cue_ms}
    under: list[str] = []
    if caption_fx.uses_box():
        under.append(dialogue(start, end, y, box_line(line, active), style="Box", **timing))
    if caption_fx.uses_backdrop():
        under.append(dialogue(start, end, y, plain_line(line, r"\1a&HFF&"), style="Backdrop", **timing))
    for dx, colour in caption_fx.glitch_ghosts():
        ghost = rf"\bord0\shad0\c{ass_color(colour)}&\alpha&H{caption_fx.GLITCH_ALPHA:02X}&"
        under.append(dialogue(start, end, y, plain_line(line, ghost), dx=dx, **timing))
    text = dialogue(start, end, y, render_line(line, active, marked), layer=1 if under else 0, **timing)
    return [*under, text]


def cue_events(cue: Cue, anchor: str = "normal", margin_v: int | None = None,
               clip_start: float = 0.0, index: int = 0) -> list[str]:
    """Dialogue ទាំងអស់សម្រាប់ cue មួយ.

    ពេលបើកការបំលេចតាមសំឡេង យើងបញ្ចេញបន្ទាត់ទាំងអស់ឡើងវិញក្នុងមួយចន្លោះពេលពាក្យ
    (ពាក្យ × បន្ទាត់ event) ព្រោះបន្ទាត់ផ្សេងត្រូវតែនៅលើអេក្រង់ដដែល។
    """
    ys = line_positions(len(cue.lines), anchor, margin_v)
    marked = keyword_colours(cue, index)
    cue_ms = round((cue.end - cue.start) * 1000)

    if not config.CAPTION_WORD_HIGHLIGHT:
        keywords = pick_keywords(cue)
        events = []
        for line, y in zip(cue.lines, ys):
            active = next((w for w in line
                           if re.sub(r"[^\w']", "", w.word.strip().lower()) in keywords), None)
            events.extend(line_events(cue.start, cue.end, y, line, active, marked, 0, cue_ms))
        return events

    words = [w for line in cue.lines for w in line]
    events = []
    for word, (start, end) in zip(words, word_intervals(cue, clip_start)):
        # ពាក្យចុងក្រោយអាចចាប់ផ្តើមត្រង់ចុង cue (Whisper ឲ្យពេលមិនច្បាស់) ->
        # ចន្លោះ 0 វិនាទី។ Event បែបនេះគ្មានអ្វីបង្ហាញ ហើយជាសំរាមក្នុង .ass។
        if end - start < 0.02:
            continue
        offset = round((start - cue.start) * 1000)
        for line, y in zip(cue.lines, ys):
            events.extend(line_events(start, end, y, line, word, marked, offset, cue_ms))

    if not events:        # គ្រប់ចន្លោះខ្លីពេក -> បង្ហាញ cue ដោយគ្មានការបំលេច
        return [event for line, y in zip(cue.lines, ys)
                for event in line_events(cue.start, cue.end, y, line, None, marked, 0, cue_ms)]
    return events


# ---------- ASS file ----------

def shadow_colour() -> str:
    """BackColour របស់ style (`&HAABBGGRR`) — ពណ៌ shadow ជាមួយ alpha ពាក់កណ្តាលដូចមុន."""
    return f"&H{config.CAPTION_SHADOW_ALPHA:02X}{ass_color(config.CAPTION_SHADOW_COLOR)[4:]}"


def shadow_tags() -> str:
    """Tag shadow សម្រាប់ x / y ដាច់ពីគ្នា និង blur (`\\xshad \\yshad \\blur` របស់ libass).

    (1, 1, 0) = Shadow=1 របស់ style ដដែល -> គ្មាន tag (.ass ដូចមុនបេះបិទ).
    """
    x, y, blur = config.CAPTION_SHADOW_XY_BLUR
    if (x, y, blur) == (1, 1, 0):
        return ""
    return f"\\xshad{x}\\yshad{y}" + (f"\\blur{blur}" if blur else "")


def box_style(font: str, margin_v: int) -> list[str]:
    """Style `Box` (BorderStyle 3 = ប្រអប់ជំនួសគ្រោង) សម្រាប់ animation box / highlighter, ឬ [] .

    font, ទំហំ, italic ដូច Default ដើម្បីឲ្យប្រអប់ត្រូវនឹងពាក្យ; ពណ៌ប្រអប់ = ពណ៌បំលេច.
    """
    from pipeline import caption_fx
    if not caption_fx.uses_box():
        return []
    colour = f"&H{caption_fx.box_alpha():02X}{ass_color(config.CAPTION_KEYWORD_COLOR)[4:]}"
    return [
        f"Style: Box,{font},{config.CAPTION_FONT_SIZE},&HFF000000,&HFF000000,{colour},&HFF000000,"
        f"-1,{-1 if config.CAPTION_ITALIC else 0},0,0,100,100,0,0,3,{caption_fx.box_padding()},0,2,"
        f"{config.CAPTION_MARGIN_X},{config.CAPTION_MARGIN_X},{margin_v},1"
    ]


def backdrop_style(font: str, margin_v: int) -> list[str]:
    """Style `Backdrop` (BorderStyle 4 របស់ libass = ប្រអប់មួយពីក្រោយបន្ទាត់ទាំងមូល, ពណ៌ BackColour)."""
    from pipeline import caption_fx
    if not caption_fx.uses_backdrop():
        return []
    colour = f"&H{caption_fx.BACKDROP_ALPHA:02X}{ass_color(caption_fx.BACKDROP_COLOR)[4:]}"
    return [
        f"Style: Backdrop,{font},{config.CAPTION_FONT_SIZE},&HFF000000,&HFF000000,{colour},{colour},"
        f"-1,{-1 if config.CAPTION_ITALIC else 0},0,0,100,100,0,0,4,{caption_fx.backdrop_padding()},0,2,"
        f"{config.CAPTION_MARGIN_X},{config.CAPTION_MARGIN_X},{margin_v},1"
    ]


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
            f"{outline},{shadow_colour()},-1,{-1 if config.CAPTION_ITALIC else 0},"
            f"{-1 if config.CAPTION_UNDERLINE else 0},0,100,100,0,0,1,"
            f"{config.CAPTION_OUTLINE},{config.CAPTION_SHADOW},2,"
            f"{config.CAPTION_MARGIN_X},{config.CAPTION_MARGIN_X},{margin_v},1"
        ),
        *box_style(font, margin_v),
        *backdrop_style(font, margin_v),
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
    for index, cue in enumerate(cues):
        anchor = anchor_for(cue, clip.start, segments)
        lines.extend(cue_events(cue, anchor, margin_v, clip_start=clip.start, index=index))

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
        ass_path = build_ass(clip, transcript, out_dir / f"clip_{index:02d}.ass",
                             font=font, margin_v=margin, segments=segments)
        paths.append(ass_path)
        write_sidecars(clip, transcript, ass_path)
    return paths



# ---------- SRT / VTT (file សម្រាប់ upload, §11) ----------

def timestamp(seconds: float, separator: str = ",") -> str:
    """HH:MM:SS,mmm (SRT) ឬ HH:MM:SS.mmm (VTT)."""
    seconds = max(0.0, seconds)
    milliseconds = int(round(seconds * 1000))
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    whole, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole:02d}{separator}{milliseconds:03d}"


def cue_plain_text(cue: Cue) -> str:
    """អត្ថបទធម្មតា — **រក្សាវណ្ណយុត្តិ និងអក្សរតូច/ធំដើម**.

    `.ass` ដែលដុតចូលវីដេអូប្រើអក្សរធំគ្មានវណ្ណយុត្តិ (style short-form) តែ file
    caption សម្រាប់ upload គួរជាអត្ថបទពិត — platform និង screen reader អានវា។

    បន្ទាត់ត្រូវភ្ជាប់គ្នា ព្រោះការបំបែក ១៦ តួជាលក្ខណៈនៃអេក្រង់បញ្ឈរ មិនមែន
    ជាទម្រង់នៃ file caption ទេ (platform រៀបបន្ទាត់ខ្លួនឯង)។
    """
    return " ".join(w.word.strip() for line in cue.lines for w in line)


def build_srt(cues: list[Cue]) -> str:
    """SRT: លេខរៀង, ពេល, អត្ថបទ, បន្ទាត់ទទេ."""
    blocks = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(f"{index}\n"
                      f"{timestamp(cue.start)} --> {timestamp(cue.end)}\n"
                      f"{cue_plain_text(cue)}\n")
    return "\n".join(blocks)


def build_vtt(cues: list[Cue]) -> str:
    """WebVTT: ដូច SRT តែមាន header ហើយប្រើ `.` ជំនួស `,`."""
    blocks = ["WEBVTT\n"]
    for cue in cues:
        blocks.append(f"{timestamp(cue.start, '.')} --> {timestamp(cue.end, '.')}\n"
                      f"{cue_plain_text(cue)}\n")
    return "\n".join(blocks)


def write_sidecars(clip: Clip, transcript: Transcript, ass_path: Path) -> list[Path]:
    """សរសេរ `.srt` / `.vtt` ក្បែរ `.ass` តាម `config.CAPTION_SIDECARS`."""
    words = words_in_clip(clip, transcript)
    cues = wrap_into_cues(words, clip.start)
    written: list[Path] = []
    builders = {"srt": build_srt, "vtt": build_vtt}
    for suffix in config.CAPTION_SIDECARS:
        build = builders.get(suffix)
        if build is None:
            continue
        path = Path(ass_path).with_suffix(f".{suffix}")
        path.write_text(build(cues), encoding="utf-8")
        written.append(path)
    return written

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
