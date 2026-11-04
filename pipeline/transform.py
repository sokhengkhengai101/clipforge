"""Transform video (Edit Video): វីដេអូដែលអ្នកដាក់ទីតាំង និងទំហំដោយដៃ ពីលើផ្ទៃ Fit.

លំដាប់ FFmpeg មាន ៣: **crop** (កាត់គែមវីដេអូដើម) -> **scale** (ទំហំថ្មី) -> **overlay**
(ដាក់លើ background blur / ពណ៌ / រូប ដូច Fit). លេខទាំងអស់ជាប្រភាគ 0-1 ដូច្នេះមិនអាស្រ័យ
លើ resolution ទេ — preview ក្នុង browser ប្រើលេខដដែល.

ឧ. crop (0.12, 0, 0.76, 1) = ដក 12% ពីឆ្វេង និងស្តាំ; transform (0.5, 0.5, 0.9) = កណ្តាលអេក្រង់
ទទឹង 90% នៃ output -> 1280x720 ទៅ 1080x1920: crop 972x720 -> 972x720 -> ដាក់នៅ (54, 600).
"""

from dataclasses import dataclass

SCALE_RANGE = (0.1, 4.0)        # Fill 16:9 -> 9:16 = 3.16; ទទឹងវីដេអូ ជាផ្នែកនៃទទឹង output (> 1 = ធំជាងអេក្រង់, ចេញក្រៅ)
MIN_CROP = 0.05                 # crop តូចជាង 5% នៃវីដេអូ = មិនមែនចេតនាទេ


class TransformError(ValueError):
    pass


@dataclass(frozen=True)
class Transform:
    x: float = 0.5               # កណ្តាលវីដេអូ ជាផ្នែកនៃទទឹង output
    y: float = 0.5               # កណ្តាលវីដេអូ ជាផ្នែកនៃកម្ពស់ output
    scale: float = 1.0           # ទទឹងវីដេអូ / ទទឹង output
    crop: tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0)   # x, y, w, h នៃវីដេអូដើម

    def as_flags(self) -> list[str]:
        return ["--transform", f"{self.x:g},{self.y:g},{self.scale:g}",
                "--transform-crop", ",".join(f"{v:g}" for v in self.crop)]


def _numbers(text: str, count: int, name: str) -> list[float]:
    parts = [part.strip() for part in str(text).split(",")]
    if len(parts) != count:
        raise TransformError(f"{name} ត្រូវមាន {count} លេខ (បំបែកដោយ ,): {text}")
    try:
        return [float(part) for part in parts]
    except ValueError:
        raise TransformError(f"{name} ត្រូវជាលេខ: {text}") from None


def parse(transform: str, crop: str | None = None) -> Transform:
    """`"0.5,0.5,0.9"` + `"0.12,0,0.76,1"` -> Transform, ឬ TransformError បើលេខខុស."""
    x, y, scale = _numbers(transform, 3, "--transform")
    if not (-1 <= x <= 2 and -1 <= y <= 2):
        raise TransformError("ទីតាំង x, y ត្រូវនៅចន្លោះ -1 និង 2")
    if not SCALE_RANGE[0] <= scale <= SCALE_RANGE[1]:
        raise TransformError(f"scale ត្រូវនៅចន្លោះ {SCALE_RANGE[0]} និង {SCALE_RANGE[1]}")
    box = (0.0, 0.0, 1.0, 1.0)
    if crop:
        cx, cy, cw, ch = _numbers(crop, 4, "--transform-crop")
        if cw < MIN_CROP or ch < MIN_CROP or cx < 0 or cy < 0 or cx + cw > 1.0001 or cy + ch > 1.0001:
            raise TransformError("crop ត្រូវនៅក្នុងវីដេអូ (0-1) ហើយធំជាង 5%")
        box = (cx, cy, min(cw, 1 - cx), min(ch, 1 - cy))
    return Transform(x, y, scale, box)


def crop_pixels(transform: Transform, source_w: int, source_h: int) -> tuple[int, int, int, int]:
    """ប្រអប់ crop ជា pixel នៃវីដេអូដើម (ទំហំលេខគូ ព្រោះ yuv420p)."""
    cx, cy, cw, ch = transform.crop
    w = max(2, int(source_w * cw) // 2 * 2)
    h = max(2, int(source_h * ch) // 2 * 2)
    x = min(round(source_w * cx), source_w - w)
    y = min(round(source_h * cy), source_h - h)
    return x, y, w, h


def foreground_size(transform: Transform, source_w: int, source_h: int,
                    out_w: int) -> tuple[int, int]:
    """ទំហំវីដេអូលើ output: ទទឹង = scale x ទទឹង output, កម្ពស់តាមសមាមាត្រ crop (លេខគូ)."""
    _, _, crop_w, crop_h = crop_pixels(transform, source_w, source_h)
    width = max(2, int(out_w * transform.scale) // 2 * 2)
    height = max(2, int(width * crop_h / crop_w) // 2 * 2)
    return width, height


def top_left(transform: Transform, size: tuple[int, int], out_w: int, out_h: int) -> tuple[int, int]:
    """ជ្រុងឆ្វេងលើនៃវីដេអូ ពីកណ្តាល (x, y) — អាចអវិជ្ជមាន (ចេញក្រៅ, overlay កាត់ចោល)."""
    width, height = size
    return round(transform.x * out_w - width / 2), round(transform.y * out_h - height / 2)
