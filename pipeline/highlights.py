"""ជំហាន 3 — chunk transcript (~5 min, 30 s overlap) -> LLM -> clips JSON.

ហូរការងារ: chunk -> prompt -> LLM -> validate (pydantic) -> dedupe overlaps -> top N by score.

**pydantic ជាអ្វី?** វាពិនិត្យថា data ត្រូវរូបរាងឬអត់ ហើយបម្លែង type ឲ្យស្រប។ LLM ជួនកាល
ឆ្លើយ `"score": "8"` (string) ឬខ្វះ field។ pydantic បម្លែង `"8"` -> `8.0` ហើយបោះ
`ValidationError` ពេល data ពិតជាខុស — យើងរំលង clip នោះ មិនឲ្យ pipeline ទាំងមូលដាច់។
ឧទាហរណ៍តូច: `Clip(start=1, end="9.5", title="x", score="8")` -> ក្លាយជាលេខទាំងអស់។
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, ValidationError, field_validator, model_validator

import config
from pipeline.llm import LLMError, complete_json
from pipeline.transcribe import Segment, Transcript

CACHE_VERSION = 5   # v5: cache ផ្ទុក candidate ច្រើន -> v4: បន្ថែមជំហានតម្រៀប -> v3: prompt ប្តូរ -> v2: prompt ប្តូរ -> cache ចាស់ត្រូវធ្វើថ្មី

# ប្រភេទ clip ដែលយើងទទួល (ត្រូវគ្នានឹង prompt)
CLIP_TYPES = ("story", "insight", "howto", "contrarian", "question", "funny")

# ដែនកំណត់ទូលាយនៅជំហាននេះ — `boundaries.py` ទើបរឹតបន្តឹងទៅ 15-90s
LOOSE_MIN_SEC = 5.0
LOOSE_MAX_SEC = 300.0


class HighlightsError(RuntimeError):
    """រកមិនបាន highlight ឬ LLM បរាជ័យទាំងអស់."""


# ---------- ពិន្ទុតាមវិមាត្រ (rubric) ----------

# ទម្ងន់ពីការស្រាវជ្រាវ: hook .35, flow .25, value .30, trend .10។ យើងទម្លាក់
# `trend` (ទម្ងន់ 0) ព្រោះវាត្រូវការទិន្នន័យខាងក្រៅ (អ្វីកំពុងល្បី) ដែល model
# ក្នុងម៉ាស៊ីនមិនអាចដឹង — វានឹងទាយ។ ទម្ងន់ដែលនៅសល់ត្រូវធ្វើមាត្រដ្ឋានឡើងវិញ។
RUBRIC_WEIGHTS = {"hook": 0.35, "flow": 0.25, "value": 0.30}

# តារាងអក្សរពីការស្រាវជ្រាវ (§3.6)
GRADE_TABLE = ((93, "A"), (88, "A-"), (83, "B+"), (78, "B"), (73, "B-"),
               (68, "C+"), (63, "C"), (58, "C-"), (0, "D"))


def letter_for(value: float) -> str:
    """បម្លែងពិន្ទុ 0-100 ទៅជាអក្សរ. 87 -> "A-"."""
    return next(letter for threshold, letter in GRADE_TABLE if value >= threshold)


class Dimension(BaseModel):
    """ពិន្ទុមួយវិមាត្រ + មូលហេតុខ្លីសម្រាប់បង្ហាញក្នុង UI."""

    score: float = 50.0
    reason: str = ""

    @field_validator("score", mode="before")
    @classmethod
    def _clamp(cls, value: object) -> float:
        try:
            return min(100.0, max(0.0, float(value)))
        except (TypeError, ValueError):
            return 50.0

    @field_validator("reason", mode="before")
    @classmethod
    def _clean(cls, value: object) -> str:
        return " ".join(str(value or "").split())

    @property
    def letter(self) -> str:
        return letter_for(self.score)


class Grades(BaseModel):
    """Hook / Flow / Value — ការវិនិច្ឆ័យក្នុងមួយវិមាត្រ.

    **ហេតុអ្វីវិមាត្រច្រើនជាងពិន្ទុតែមួយ?** វាស់ពិត: ជាមួយ `score` 1-10 តែមួយ
    model ប្រើតែ 8 និង 9 (sd 0.40) ដូច្នេះការតម្រៀបស្ទើរគ្មានព័ត៌មាន។ វិមាត្រ
    នីមួយៗមាននិយមន័យដាច់ដោយឡែក ដូច្នេះវាបែងចែកបានល្អជាង។
    """

    hook: Dimension = Dimension()
    flow: Dimension = Dimension()
    value: Dimension = Dimension()

    @property
    def total(self) -> float:
        """ពិន្ទុរួម 0-100 (ទម្ងន់ធ្វើមាត្រដ្ឋានឲ្យបូកបាន 1.0)."""
        weight_sum = sum(RUBRIC_WEIGHTS.values())
        return round(sum(getattr(self, name).score * weight
                         for name, weight in RUBRIC_WEIGHTS.items()) / weight_sum)

    @property
    def letter(self) -> str:
        return letter_for(self.total)


class Clip(BaseModel):
    """clip មួយដែល LLM ស្នើ (ក្រោយ validate រួច)."""

    start: float
    end: float
    title: str
    hook: str = ""
    type: str = "insight"
    score: float = 5.0
    reason: str = ""
    grades: Grades | None = None          # `None` = candidate ចាស់ពីមុន rubric

    @field_validator("type", mode="before")
    @classmethod
    def _normalise_type(cls, value: object) -> str:
        """LLM អាចឆ្លើយ "Story" ឬ "how-to" ឬអ្វីដែលយើងមិនស្គាល់ -> ធ្វើឲ្យស្អាត."""
        text = str(value or "").strip().lower().replace("-", "").replace("_", "")
        return text if text in CLIP_TYPES else "insight"

    @field_validator("score", mode="before")
    @classmethod
    def _clamp_score(cls, value: object) -> float:
        try:
            score = float(value)
        except (TypeError, ValueError):
            return 5.0
        return min(10.0, max(1.0, score))     # កំណត់ក្នុង 1..10

    @field_validator("title", "hook", "reason", mode="before")
    @classmethod
    def _clean_text(cls, value: object) -> str:
        return " ".join(str(value or "").split())

    @model_validator(mode="after")
    def _check_times(self) -> "Clip":
        if self.end <= self.start:
            raise ValueError(f"end ({self.end}) must be greater than start ({self.start})")
        duration = self.end - self.start
        if not (LOOSE_MIN_SEC <= duration <= LOOSE_MAX_SEC):
            raise ValueError(f"duration {duration:.1f}s outside {LOOSE_MIN_SEC}-{LOOSE_MAX_SEC}s")
        if not self.title:
            raise ValueError("title is empty")
        return self

    @model_validator(mode="after")
    def _score_from_grades(self) -> "Clip":
        """បើមាន rubric ប្រើវាជាប្រភពពិតនៃពិន្ទុ (score ចាស់ 1-10 នៅដំណើរការ)."""
        if self.grades is not None:
            object.__setattr__(self, "score", round(self.grades.total / 10, 1))
        return self

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def total(self) -> float:
        """ពិន្ទុ 0-100 ដូច OpusClip បង្ហាញ."""
        return self.grades.total if self.grades else round(self.score * 10)

    @property
    def letter(self) -> str:
        return letter_for(self.total)


def full_video_clip(duration: float, title: str = "full") -> Clip:
    """Clip តែមួយដែលគ្របលើ video ទាំងមូល (សម្រាប់ `--full`).

    យើងប្រើ `model_construct` ដែល**រំលង validator** ដោយចេតនា៖ `Clip` កំណត់ប្រវែង
    អតិបរមា 300 វិនាទី ដើម្បីច្រោះចម្លើយ LLM ដែលឆ្គង។ ការ render ពេញ video មិនមែន
    មកពី LLM ទេ ដូច្នេះដែននោះមិនអនុវត្ត។
    """
    return Clip.model_construct(start=0.0, end=duration, title=title, hook="",
                                type="insight", score=10.0, reason="full video")


# ---------- chunking ----------

@dataclass
class Chunk:
    """ផ្នែកមួយនៃ transcript ដែលយើងផ្ញើទៅ LLM ម្តង."""

    index: int
    start: float
    end: float
    segments: list[Segment] = field(default_factory=list)

    def as_prompt_text(self) -> str:
        """បម្លែងទៅអក្សរ `[start - end] text` ក្នុងមួយបន្ទាត់."""
        lines = [f"[{s.start:.1f} - {s.end:.1f}] {s.text}" for s in self.segments]
        return "\n".join(lines)


def chunk_transcript(
    transcript: Transcript,
    chunk_sec: float | None = None,
    overlap_sec: float | None = None,
) -> list[Chunk]:
    """ចែក transcript ជាផ្នែកៗដែលត្រួតគ្នាបន្តិច.

    **ហេតុអ្វីត្រូវត្រួតគ្នា (overlap)?** បើយើងកាត់ត្រង់ 5:00 គត់ ហើយរឿងល្អចាប់ផ្តើម
    នៅ 4:50 វានឹងដាច់ជាពីរ ហើយ LLM មិនឃើញវាទាំងមូល។ ការត្រួតគ្នា 30 វិនាទីធានាថា
    គ្រប់ idea មានវត្តមានពេញលេញក្នុង chunk ណាមួយ។
    """
    chunk_sec = chunk_sec or config.CHUNK_SEC
    overlap_sec = overlap_sec if overlap_sec is not None else config.CHUNK_OVERLAP_SEC
    if overlap_sec >= chunk_sec:
        raise ValueError("overlap ត្រូវតូចជាង chunk")

    if not transcript.segments:
        return []

    total = max(transcript.duration, transcript.segments[-1].end)
    step = chunk_sec - overlap_sec

    chunks: list[Chunk] = []
    start = 0.0
    while start < total:
        end = min(start + chunk_sec, total)
        # segment ណាដែលប៉ះ window នេះ (ទោះត្រួតតែបន្តិច) ត្រូវយកចូល
        inside = [s for s in transcript.segments if s.end > start and s.start < end]
        if inside:
            chunks.append(Chunk(index=len(chunks), start=start, end=end, segments=inside))
        if end >= total:
            break
        start += step

    return chunks


# ---------- prompt ----------

def load_prompt(name: str | None = None,
                body_sections: tuple[str, ...] = ("User", "Transcript part")
                ) -> tuple[str, str]:
    """អាន prompt file រួចបែងចែកជា (system, user_template).

    File មានផ្នែក `## System`, `## User`, ផ្នែកទិន្នន័យ (`## Transcript part` ឬ
    `## Candidates`), និង `## Changelog`។ យើងយក System ដោយឡែក, ភ្ជាប់ផ្នែកខាងក្រោម
    ជា template, ហើយបោះ Changelog ចោល (វាសម្រាប់មនុស្សអាន មិនមែនសម្រាប់ model)។
    """
    path = config.PROMPTS_DIR / (name or config.HIGHLIGHT_PROMPT)
    text = path.read_text(encoding="utf-8")

    sections: dict[str, str] = {}
    for block in re.split(r"^## ", text, flags=re.MULTILINE)[1:]:
        header, _, body = block.partition("\n")
        sections[header.strip()] = body.strip()

    missing = [k for k in ("System", *body_sections) if k not in sections]
    if missing:
        raise HighlightsError(f"{path.name} ខ្វះផ្នែក: {', '.join(missing)}")

    parts = [sections[body_sections[0]]]
    for header in body_sections[1:]:
        parts.append(f"## {header}\n\n{sections[header]}")
    return sections["System"], "\n\n".join(parts)


def build_prompt(chunk: Chunk, user_template: str, clips_per_chunk: int) -> str:
    """ដាក់តម្លៃពិតជំនួស placeholder `{{...}}` ក្នុង template.

    យើងប្រើ `{{NAME}}` + `.replace()` មិនមែន `.format()` ព្រោះ prompt មាន JSON example
    ដែលមាន `{` `}` — `.format()` នឹងយល់ច្រឡំថាជា placeholder ហើយ crash។
    """
    return (
        user_template
        .replace("{{MIN_SEC}}", str(int(config.MIN_CLIP_SEC)))
        .replace("{{MAX_SEC}}", str(int(config.MAX_CLIP_SEC)))
        .replace("{{MAX_CLIPS}}", str(clips_per_chunk))
        .replace("{{TRANSCRIPT}}", chunk.as_prompt_text())
    )


# ---------- validate + dedupe ----------

def parse_clips(
    data: object,
    video_duration: float,
    on_warning: Callable[[str], None] | None = None,
) -> list[Clip]:
    """បម្លែងចម្លើយ LLM ទៅ list[Clip] ដោយរំលង clip ដែលខុស (មិន crash)."""
    if isinstance(data, dict):
        raw_list = data.get("clips", [])
    elif isinstance(data, list):
        raw_list = data            # model ខ្លះឆ្លើយ list ត្រង់ៗ
    else:
        raw_list = []

    clips: list[Clip] = []
    for i, raw in enumerate(raw_list):
        if not isinstance(raw, dict):
            continue
        try:
            clip = Clip(**raw)
        except ValidationError as e:
            if on_warning:
                # `e.errors()` ផ្តល់សារពិត។ `str(e)` បញ្ចប់ដោយ URL ឯកសារ ដែលគ្មានប្រយោជន៍។
                detail = "; ".join(
                    f"{'.'.join(str(x) for x in err['loc']) or 'clip'}: {err['msg']}"
                    for err in e.errors()
                )
                on_warning(f"clip #{i} ត្រូវរំលង: {detail}")
            continue
        except TypeError as e:
            if on_warning:
                on_warning(f"clip #{i} ត្រូវរំលង: {e}")
            continue

        # កាត់ឲ្យនៅក្នុងដែនវីដេអូ (LLM ជួនកាលទាយពេលលើស)
        if clip.start >= video_duration:
            if on_warning:
                on_warning(f"clip #{i} ត្រូវរំលង: start {clip.start:.1f}s លើសវីដេអូ")
            continue
        if clip.end > video_duration:
            clip = clip.model_copy(update={"end": video_duration})
            if clip.duration < LOOSE_MIN_SEC:
                continue

        clips.append(clip)

    return clips


def overlap_seconds(a: Clip, b: Clip) -> float:
    """ចំនួនវិនាទីដែល clip ២ ត្រួតគ្នា (0 បើមិនត្រួត)."""
    return max(0.0, min(a.end, b.end) - max(a.start, b.start))


def dedupe_overlaps(clips: list[Clip], max_overlap_ratio: float = 0.3) -> list[Clip]:
    """chunk ត្រួតគ្នា -> LLM អាចស្នើ clip ដូចគ្នាពីរដង. រក្សាតែមួយដែល score ខ្ពស់.

    `max_overlap_ratio` គិតធៀបនឹង clip ខ្លីជាង: 0.3 = ត្រួតលើស 30% ចាត់ជាស្ទួន។
    """
    kept: list[Clip] = []
    for clip in sorted(clips, key=lambda c: c.score, reverse=True):
        is_duplicate = False
        for other in kept:
            shorter = min(clip.duration, other.duration)
            if shorter > 0 and overlap_seconds(clip, other) / shorter > max_overlap_ratio:
                is_duplicate = True
                break
        if not is_duplicate:
            kept.append(clip)

    # យើងប្រើ score ដើម្បី *សម្រេច* ថារក្សាមួយណាក្នុងចំណោម clip ស្ទួន តែត្រឡប់តាម
    # **លំដាប់ដើម** ព្រោះអ្នកហៅអាចបានដាក់លំដាប់ដោយចេតនារួចហើយ។
    original = {id(clip): index for index, clip in enumerate(clips)}
    kept.sort(key=lambda c: original[id(c)])
    return kept


# ---------- cache ----------

def save_clips(clips: list[Clip], path: Path, *, model: str, prompt: str) -> Path:
    """សរសេរ clips ទៅ JSON (មាន model + prompt ដើម្បីដឹងថាវាមកពីណា)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "cache_version": CACHE_VERSION,
        "model": model,
        "prompt": prompt,
        "clips": [c.model_dump() for c in clips],
    }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_clips(path: Path, any_version: bool = False) -> list[Clip] | None:
    """អាន cache មកវិញ. ត្រឡប់ None បើគ្មាន/ខូច/ចាស់.

    `any_version=True` អាន cache ចាស់ដែរ. វាមានពីរអត្ថន័យខុសគ្នា៖ ក្នុង
    pipeline, version ចាស់ = "រត់ LLM ម្តងទៀត" ដូច្នេះ None ជាចម្លើយត្រូវ;
    តែសម្រាប់ **បង្ហាញ** clip ដែល render រួចហើយ (UI, review.py), ការបដិសេធ
    ធ្វើឲ្យ project ចាស់មើលមិនឃើញទាំងស្រុង ទោះ .mp4 មានពេញលើ disk. Schema
    ទ្រាំបាន៖ clip មុន rubric គ្មាន `grades` ហើយ `Clip` ទទួលវាធម្មតា.
    """
    path = Path(path)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not any_version and data.get("cache_version") != CACHE_VERSION:
        return None
    try:
        return [Clip(**c) for c in data["clips"]]
    except (ValidationError, KeyError, TypeError):
        return None


# ---------- ជំហានតម្រៀប (ដោះស្រាយពិន្ទុដែលជាប់គាំងនៅ 9) ----------

def format_candidates(clips: list[Clip], transcript: Transcript,
                      preview_chars: int = 180) -> str:
    """រាយ candidate សម្រាប់ prompt តម្រៀប — លេខ, ប្រវែង, title, និងពាក្យដំបូង."""
    lines: list[str] = []
    for number, clip in enumerate(clips, start=1):
        words = [
            w for seg in transcript.segments for w in seg.words
            if w.end > clip.start and w.start < clip.end
        ]
        opening = " ".join(w.word.strip() for w in words).strip()[:preview_chars]
        if not opening:
            opening = clip.hook or clip.title
        lines.append(f'{number}. [{clip.duration:.0f}s] {clip.title}')
        lines.append(f'   "{opening}..."')
        lines.append("")        # បន្ទាត់ទទេរវាង candidate ឲ្យ prompt អានងាយ
    return "\n".join(lines).strip()


def parse_order(data: object, count: int) -> list[int]:
    """បម្លែងចម្លើយ LLM ទៅលំដាប់ index (0-based) ដែលត្រឹមត្រូវ.

    យើងមិនជឿថា model នឹងត្រឡប់លេខគ្រប់ និងមិនស្ទួនទេ — ដូច្នេះយើងច្រោះលេខខុស,
    លុបលេខស្ទួន, រួចបន្ថែមលេខដែលបាត់ទៅចុង។
    """
    raw = data.get("order", []) if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raw = []

    order: list[int] = []
    for value in raw:
        try:
            index = int(value) - 1          # prompt ប្រើលេខចាប់ពី ១
        except (TypeError, ValueError):
            continue
        if 0 <= index < count and index not in order:
            order.append(index)

    order.extend(i for i in range(count) if i not in order)
    return order


def rank_clips(
    clips: list[Clip],
    transcript: Transcript,
    *,
    model: str | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> list[Clip]:
    """សុំ LLM ដាក់លំដាប់ candidate ធៀបគ្នា រួចត្រឡប់តាមលំដាប់នោះ.

    បើការហៅបរាជ័យ យើងត្រឡប់លំដាប់ដើម (តាម score) — មិនដាច់ទេ។
    """
    if len(clips) < 2:
        return clips

    model = model or config.OLLAMA_MODEL
    system, user_template = load_prompt(config.RANK_PROMPT,
                                        body_sections=("User", "Candidates"))
    prompt = user_template.replace("{{CANDIDATES}}",
                                   format_candidates(clips, transcript))
    try:
        data = complete_json(prompt, system=system, model=model)
    except LLMError as e:
        if on_warning:
            on_warning(f"ការតម្រៀបបរាជ័យ ({e}) — ប្រើលំដាប់តាម score ជំនួស")
        return clips

    order = parse_order(data, len(clips))
    return [clips[i] for i in order]


# ---------- ការងារសំខាន់ ----------

def find_highlights(
    transcript: Transcript,
    *,
    max_clips: int | None = None,
    model: str | None = None,
    cache_path: Path | None = None,
    force: bool = False,
    on_progress: Callable[[int, int], None] | None = None,
    on_warning: Callable[[str], None] | None = None,
) -> list[Clip]:
    """រក clip ល្អបំផុតពី transcript មួយ.

    ត្រឡប់ clip ដែល validate រួច, dedupe រួច, តម្រៀបតាម score (ខ្ពស់មុន), យកត្រឹម max_clips។

    **ការតម្រៀបពិតកើតឡើងក្រោយ `boundaries.py`** (មើល `rank_clips`) ព្រោះ candidate ឆៅ
    អាចចាប់ផ្តើមពាក់កណ្តាលប្រយោគ ហើយ LLM មិនគួរវិនិច្ឆ័យអ្វីដែលអ្នកមើលមិនឃើញទេ។
    """
    max_clips = max_clips or config.MAX_CLIPS
    model = model or config.OLLAMA_MODEL

    if cache_path is not None and not force:
        cached = load_clips(cache_path)
        if cached is not None:
            return cached

    chunks = chunk_transcript(transcript)
    if not chunks:
        raise HighlightsError("transcript គ្មាន segment — គ្មានអ្វីវិភាគ")

    system, user_template = load_prompt()
    # សុំតិចក្នុងមួយ chunk រួចជ្រើសសកលពេលក្រោយ -> output tokens តិច = លឿនជាង
    clips_per_chunk = max(1, min(3, max_clips))

    all_clips: list[Clip] = []
    failures = 0
    for chunk in chunks:
        if on_progress:
            on_progress(chunk.index, len(chunks))
        prompt = build_prompt(chunk, user_template, clips_per_chunk)
        try:
            data = complete_json(prompt, system=system, model=model)
        except LLMError as e:
            failures += 1
            if on_warning:
                on_warning(f"chunk {chunk.index + 1}/{len(chunks)} បរាជ័យ: {e}")
            continue
        all_clips.extend(parse_clips(data, transcript.duration, on_warning))

    if on_progress:
        on_progress(len(chunks), len(chunks))

    if failures == len(chunks):
        raise HighlightsError(f"LLM បរាជ័យលើ chunk ទាំង {failures} — ពិនិត្យថា Ollama រត់ឬអត់")

    best = dedupe_overlaps(all_clips)
    best.sort(key=lambda c: c.score, reverse=True)
    best = best[:max_clips]

    if cache_path is not None:
        save_clips(best, cache_path, model=model, prompt=config.HIGHLIGHT_PROMPT)

    return best
