"""ចលនា caption (Captions › Effects › Animation) — tag ASS ដែល libass គូរ.

ចលនាមានបីប្រភេទ (រូប OpusClip, អ្នកអភិវឌ្ឍ 2026-10-26):
- **ពេល cue លេច** (`ENTRANCES`): ចលនាខ្លីលើ cue ទាំងមូល ពេលវាលេចឡើង — bounce, fade, slide (ឡើង),
  slide_left, blur_in, soft_landing, grow.
- **ពាក្យកំពុងនិយាយ**: pop (ពង្រីកបញ្ឈរ 110%, លំនាំដើម), baby_steps (ពាក្យលេចម្តងមួយៗ) ...
- **ពេល cue នៅលើអេក្រង់** (`HOLDS`): breathe, baby_earthquake, glitch_infinite_zoom, with_backdrop.

**ហេតុអ្វីពេលអវិជ្ជមាន?** ពាក្យនីមួយៗជា `Dialogue` ដាច់ (ការបំលេចតាមសំឡេង) ហើយពាក្យទីមួយអាចខ្លីជាង
ចលនា. Event បន្ទាប់ៗទទួល tag ដដែល ដែលពេល**ដកថយ** offset (`\\t(-70,90,...)`) ដូច្នេះចលនាបន្តដោយ
មិនលោត — libass ទទួលពេលអវិជ្ជមាន (វាស់: slide 1038.5 -> 998.5 px រលូនឆ្លងព្រំ event នៅ 70 ms).
"""

import config

# រយៈពេលចលនាលេច (ms) — ចលនាដែលធ្លាក់/រីកធំ ត្រូវការពេលយូរជាងបន្តិច ទើបភ្នែកឃើញ
INTRO_MS = {"bounce": 160, "fade": 160, "slide": 160, "slide_left": 200, "blur_in": 220,
            "soft_landing": 260, "grow": 250}
ENTRANCES = frozenset(INTRO_MS)


def intro_ms(kind: str | None = None) -> int:
    kind = config.CAPTION_ANIMATION if kind is None else kind
    return INTRO_MS.get(kind, 0)


def intro_tags(x: float, y: float, offset_ms: int, kind: str | None = None) -> str:
    """Tag ទីតាំង + ចលនាលេច សម្រាប់ event ដែលចាប់ផ្តើម `offset_ms` ក្រោយ cue.

    ឧ. slide_left, offset 0: `\\an5\\move(620,y,540,y,0,200)` — ចូលពីស្តាំ 80 px ក្នុង 200 ms.
    """
    kind = config.CAPTION_ANIMATION if kind is None else kind
    position = f"\\an5\\pos({x:.0f},{y:.0f})"
    duration = intro_ms(kind)
    if not duration or offset_ms >= duration:
        return position
    a, b = -offset_ms, duration - offset_ms
    fade_in = f"\\alpha&HFF&\\t({a},{b},\\alpha&H00&)"
    if kind == "fade":
        return f"{position}{fade_in}"
    if kind == "slide":
        rise = round(config.OUT_HEIGHT * 0.02)              # 40 px នៃ 1920
        return f"\\an5\\move({x:.0f},{y + rise:.0f},{x:.0f},{y:.0f},{a},{b})\\alpha&H80&\\t({a},{b},\\alpha&H00&)"
    if kind == "slide_left":
        shift = round(config.OUT_WIDTH * 0.075)             # 80 px នៃ 1080: ចូលពីស្តាំ
        return f"\\an5\\move({x + shift:.0f},{y:.0f},{x:.0f},{y:.0f},{a},{b}){fade_in}"
    if kind == "blur_in":
        # ព្រិល 20 -> ច្បាស់ ហើយភ្លឺឡើងក្នុងពេលតែមួយ
        return f"{position}\\blur20\\alpha&HFF&\\t({a},{b},\\blur0\\alpha&H00&)"
    if kind == "soft_landing":
        # ធ្លាក់ពីលើ 3% ដោយ ease-out (accel 0.5 = លឿនដើម យឺតចុង) + fade
        drop = round(config.OUT_HEIGHT * 0.03)
        return (f"\\an5\\move({x:.0f},{y - drop:.0f},{x:.0f},{y:.0f},{a},{b})"
                f"\\alpha&HFF&\\t({a},{b},0.5,\\alpha&H00&)")
    if kind == "grow":
        return f"{position}\\fscx0\\fscy0\\t({a},{b},0.6,\\fscx100\\fscy100)"
    # bounce: តូច -> ធំជាងបន្តិច -> ធម្មតា
    middle = a + round(duration * 0.55)
    return (f"{position}\\fscx70\\fscy70\\t({a},{middle},\\fscx112\\fscy112)"
            f"\\t({middle},{b},\\fscx100\\fscy100)")


def hides_future_words(kind: str | None = None) -> bool:
    """baby_steps: ពាក្យដែលមិនទាន់និយាយ មើលមិនឃើញ (alpha FF) តែនៅតែកាន់កន្លែង ដូច្នេះបន្ទាត់មិនលោត."""
    kind = config.CAPTION_ANIMATION if kind is None else kind
    return kind == "baby_steps"


# ---------- ក្រុម B: ពាក្យកំពុងនិយាយ ----------

WORD_EFFECTS = frozenset({"scale", "underline", "box", "highlighter", "seamless_bounce", "blur_switch", "focus"})
BOX_KINDS = frozenset({"box", "highlighter"})
# ប្រអប់ពីក្រោយពាក្យ: padding ជាផ្នែកនៃទំហំ font; highlighter ធំជាង ហើយថ្លាពាក់កណ្តាល (ដូចប៊ិចគូស)
BOX_PADDING = {"box": 0.12, "highlighter": 0.20}
HIGHLIGHTER_ALPHA = 0x60
BOX_TEXT_COLOR = "#111111"          # អក្សរងងឹតលើប្រអប់ពណ៌ (ស លើលឿង អានមិនបាន)


def _kind(kind: str | None) -> str:
    return config.CAPTION_ANIMATION if kind is None else kind


def active_word_tags(kind: str | None = None) -> tuple[str, str]:
    """(tag មុន, tag ក្រោយ) ពាក្យកំពុងនិយាយ.

    ឧ. pop = (`\\fscy110`, `\\fscy100`): ពង្រីកតែបញ្ឈរ ដូច្នេះពាក្យឯទៀតមិនរំកិល;
    scale = ពង្រីកទាំងពីរ 115% (ពាក្យជិតខាងរំកិលបន្តិច — OpusClip ធ្វើដូចនេះដែរ).
    raw string (r"...") ដូច្នេះ `\\f`, `\\t`, `\\b`, `\\u` មិនក្លាយជា escape របស់ Python.
    """
    kind = _kind(kind)
    if kind == "pop":
        scale = int(round(config.CAPTION_ACTIVE_SCALE * 100))
        return (rf"\fscy{scale}", r"\fscy100") if scale != 100 else ("", "")
    if kind == "scale":
        return r"\fscx115\fscy115", r"\fscx100\fscy100"
    if kind == "underline":
        return r"\u1", r"\u0"
    if kind == "seamless_bounce":
        # event នីមួយៗ = ពាក្យមួយ ដូច្នេះ \t ចាប់ពី 0 ពេលពាក្យចាប់ផ្តើម: លោតធំ រួចត្រឡប់
        return r"\t(0,70,\fscx115\fscy115)\t(70,170,\fscx100\fscy100)", r"\fscx100\fscy100"
    if kind == "box":
        return r"\bord0", rf"\bord{config.CAPTION_OUTLINE}"      # អក្សរងងឹតលើប្រអប់: គ្មានគ្រោង
    return "", ""


def active_word_colour(kind: str | None = None) -> str:
    """ពណ៌ពាក្យកំពុងនិយាយ: box = អក្សរងងឹតលើប្រអប់ពណ៌, highlighter = អក្សរធម្មតា, ផ្សេងទៀត = ពណ៌បំលេច."""
    kind = _kind(kind)
    if kind == "box":
        return BOX_TEXT_COLOR
    if kind == "highlighter":
        return config.CAPTION_TEXT_COLOR
    return config.CAPTION_KEYWORD_COLOR


def other_word_tags(kind: str | None = None) -> tuple[str, str]:
    """(tag មុន, tag ក្រោយ) ពាក្យ**ផ្សេង**: blur_switch = ព្រិល, focus = ស្រអាប់ 40%.

    blur_switch ដកគ្រោងចេញសិន (`\\bord0`): ពេលមានគ្រោង libass ព្រិលតែគ្រោង ហើយអក្សរនៅច្បាស់
    (វាស់ក្នុង scratchpad: `\\blur6` មិនព្រិលអ្វីសោះ, `\\bord0\\blur4` ព្រិលអក្សរ).
    """
    kind = _kind(kind)
    if kind == "blur_switch":
        return r"\bord0\blur4", rf"\bord{config.CAPTION_OUTLINE}\blur0"
    if kind == "focus":
        return r"\alpha&H99&", r"\alpha&H00&"
    return "", ""


def uses_box(kind: str | None = None) -> bool:
    return _kind(kind) in BOX_KINDS


def box_padding(kind: str | None = None) -> int:
    return round(config.CAPTION_FONT_SIZE * BOX_PADDING.get(_kind(kind), 0.12))


def box_alpha(kind: str | None = None) -> int:
    return HIGHLIGHTER_ALPHA if _kind(kind) == "highlighter" else 0


# ---------- ក្រុម C: ពេល cue នៅលើអេក្រង់ ----------

HOLDS = frozenset({"breathe", "baby_earthquake", "glitch_infinite_zoom", "with_backdrop"})
BREATHE_MS = 1400                  # ដកដង្ហើមម្តង: 700 ms ធំ, 700 ms តូចវិញ
BREATHE_SCALE = 105
QUAKE_STEP_MS = 70                 # ញ័រ: ប្តូរមុំរៀងរាល់ 70 ms
QUAKE_ANGLES = (1.4, -1.1, 0.8, -1.4, 1.1, -0.8)     # ដឺក្រេ, លំដាប់ថេរ (render ដដែលៗ = រូបដដែល)
GLITCH_SCALE = 118                 # ពង្រីក 100 -> 118% ពេញមួយ cue
GLITCH_SHIFT = 0.008               # ស្រទាប់ក្រហម/ខៀវ ឃ្លាត ±0.8% ទទឹង (9 px នៃ 1080)
GLITCH_COLOURS = ("#FF2A55", "#22D3FF")
GLITCH_ALPHA = 0x50
BACKDROP_COLOR = "#000000"
BACKDROP_ALPHA = 0x48              # ~70% ស្រអាប់
BACKDROP_PADDING = 0.22            # ជាផ្នែកនៃទំហំ font


def hold_tags(offset_ms: int, cue_ms: int, kind: str | None = None) -> str:
    """Tag ចលនាដែលរត់ពេញមួយ cue, សម្រាប់ event ដែលចាប់ផ្តើម `offset_ms` ក្រោយ cue.

    ដូចចលនាលេច: ពេលដកថយ offset ដូច្នេះ event នីមួយៗ (ពាក្យនីមួយៗ) បន្តពីកន្លែងដដែល.
    `\\t` ដែលចប់មុន event នេះ មិនចាំបាច់សរសេរ ព្រោះ breathe ត្រឡប់មក 100% វិញរាល់វដ្ត.
    ឧ. breathe offset 0, cue 1400 ms: `\\t(0,700,\\fscx105\\fscy105)\\t(700,1400,\\fscx100\\fscy100)`.
    """
    kind = _kind(kind)
    if kind == "breathe":
        half = BREATHE_MS // 2
        parts = []
        for begin in range(0, cue_ms, BREATHE_MS):
            a, b, c = begin - offset_ms, begin + half - offset_ms, begin + BREATHE_MS - offset_ms
            if c <= 0:
                continue
            parts.append(rf"\t({a},{b},\fscx{BREATHE_SCALE}\fscy{BREATHE_SCALE})"
                         rf"\t({b},{c},\fscx100\fscy100)")
        return "".join(parts)
    if kind == "baby_earthquake":
        parts, previous = [], 0.0
        for step, begin in enumerate(range(0, cue_ms, QUAKE_STEP_MS)):
            angle = QUAKE_ANGLES[step % len(QUAKE_ANGLES)]
            a, b = begin - offset_ms, begin + QUAKE_STEP_MS - offset_ms
            if b <= 0:
                previous = angle            # មុំដែល event មុនបានទៅដល់ហើយ
                continue
            parts.append(rf"\t({a},{b},\frz{angle})")
        return (rf"\frz{previous}" if previous else "") + "".join(parts)
    if kind == "glitch_infinite_zoom":
        return rf"\t({-offset_ms},{cue_ms - offset_ms},\fscx{GLITCH_SCALE}\fscy{GLITCH_SCALE})"
    return ""


def glitch_ghosts(kind: str | None = None) -> list[tuple[float, str]]:
    """ស្រទាប់ពណ៌ពីក្រោយអក្សរ (ចម្ងាយ x ជា px, ពណ៌) — glitch: ក្រហមទៅឆ្វេង ខៀវទៅស្តាំ."""
    if _kind(kind) != "glitch_infinite_zoom":
        return []
    shift = round(config.OUT_WIDTH * GLITCH_SHIFT)
    return [(-shift, GLITCH_COLOURS[0]), (shift, GLITCH_COLOURS[1])]


def uses_backdrop(kind: str | None = None) -> bool:
    return _kind(kind) == "with_backdrop"


def backdrop_padding() -> int:
    return round(config.CAPTION_FONT_SIZE * BACKDROP_PADDING)
