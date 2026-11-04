"""Font ដែលផ្ទាំង Captions › Font អាចជ្រើស — តែ font ដែលដំឡើងរួចលើកុំព្យូទ័រនេះ (គ្មាន download).

បញ្ជីខ្លីនៃ face ក្រាស់ៗសម្រាប់ caption; នីមួយៗត្រូវបានពិនិត្យថា libass ពិតជាប្រើ file ត្រឹមត្រូវ
(log `fontselect` របស់ FFmpeg: "Arial Black" -> Arial-Black, "Montserrat Black" -> Montserrat-Black ...).

**ទំហំក្នុង preview:** libass យក Fontsize ជាកម្ពស់ winAscent + winDescent មិនមែន em របស់ CSS ទេ
(Montserrat ExtraBold: 1109 + 453 នៃ 1000 -> em = 0.640 x Fontsize). `em_scale` អានពី file `.ttf`
ផ្ទាល់ ដូច្នេះ preview នៃ font នីមួយៗមានទំហំដូច render.
"""

import struct
from functools import lru_cache
from pathlib import Path

from pipeline.captions import find_font_file

# (family, ទម្ងន់, ឈ្មោះ face ដែល libass ទទួល)
FACES = (
    ("Montserrat", "SemiBold", "Montserrat SemiBold"),
    ("Montserrat", "Bold", "Montserrat Bold"),
    ("Montserrat", "ExtraBold", "Montserrat ExtraBold"),
    ("Montserrat", "Black", "Montserrat Black"),
    ("Inter", "Bold", "Inter Bold"),
    ("Arial", "Bold", "Arial Bold"),
    ("Arial", "Black", "Arial Black"),
    ("Impact", "Regular", "Impact"),
    ("Segoe UI", "Black", "Segoe UI Black"),
)
# face ដែលមាន file italic ពិត (វាស់ដោយ fontselect); ផ្សេងទៀត libass ទ្រេតខ្លួនឯង
ITALIC_FACES = frozenset({"Montserrat SemiBold", "Montserrat ExtraBold", "Montserrat Black", "Segoe UI Black"})


def em_scale(path: Path) -> float | None:
    """unitsPerEm / (winAscent + winDescent) ពីតារាង `head` និង `OS/2` របស់ TrueType/OpenType.

    ឧ. Montserrat ExtraBold: 1000 / (1109 + 453) = 0.640. `None` បើអានមិនបាន (ឧ. .ttc).
    """
    try:
        data = Path(path).read_bytes()
        count = struct.unpack(">H", data[4:6])[0]
        tables = {}
        for index in range(count):
            tag, _, offset, _ = struct.unpack(">4sIII", data[12 + 16 * index:28 + 16 * index])
            tables[tag] = offset
        units = struct.unpack(">H", data[tables[b"head"] + 18:tables[b"head"] + 20])[0]
        os2 = tables[b"OS/2"]
        ascent, descent = struct.unpack(">HH", data[os2 + 74:os2 + 78])
        return round(units / (ascent + descent), 4) if ascent + descent else None
    except (OSError, KeyError, struct.error):
        return None


@lru_cache(maxsize=1)
def installed_fonts() -> list[dict]:
    """face ពី `FACES` ដែលរកឃើញពិត: {family, weight, face, em_scale, italic_face}."""
    out = []
    for family, weight, face in FACES:
        path = find_font_file(face)
        if path is None:
            continue
        out.append({"family": family, "weight": weight, "face": face,
                    "em_scale": em_scale(path) or 0.7, "italic_face": face in ITALIC_FACES})
    return out
