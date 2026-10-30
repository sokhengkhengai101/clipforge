"""ប្តូរឈ្មោះ និងលុប project (ម៉ឺនុយ "⋯" លើទំព័រ Projects របស់ខ្ញុំ).

**ប្តូរឈ្មោះ = ឈ្មោះបង្ហាញតែប៉ុណ្ណោះ.** ឈ្មោះ folder `output/<name>` មកពីឈ្មោះ file វីដេអូ
(`make_clips.py` សរសេរទៅ `output/<video.stem>/`)។ បើប្តូរឈ្មោះ folder ការរត់លើកក្រោយលើ
វីដេអូដដែលនឹងបង្កើត folder ថ្មីដោយឈ្មោះចាស់ ហើយ project ចាស់បាត់ទំនាក់ទំនងនឹងវីដេអូ។
ដូច្នេះយើងទុកឈ្មោះថ្មីក្នុង `output/<name>/project.json` ហើយមិនផ្លាស់ទីអ្វីទាំងអស់។

**លុប = ផ្ញើ folder output ទៅ Recycle Bin.** មានតែ file ដែល pipeline បង្កើត (audio, transcript,
clips, reframe) — វីដេអូដើមនៅក្រៅ output/ ហើយមិនត្រូវបានប៉ះទេ (CLAUDE.md)។ Recycle Bin
មិនមែនលុបជារៀងរហូតទេ: អ្នកអាចយកវាមកវិញពី Windows បើលុបខុស។
"""

import json
import os
import re
import shutil
import subprocess
import threading
from functools import wraps
from pathlib import Path

TITLE_FILE = "project.json"
TITLE_MAX = 80


# Edit Video ផ្ញើ PUT /look, /motion, /cuts ក្នុងពេលតែមួយ (autosave) ហើយ FastAPI រត់វាក្នុង thread
# ផ្សេងគ្នា. អ្នកសរសេរនីមួយៗ អាន -> ប្តូរ key របស់ខ្លួន -> សរសេរ file ទាំងមូល; គ្មាន lock = មួយសរសេរ
# ពីលើការប្តូររបស់មួយទៀត. RLock: function មួយហៅមួយទៀតបាន (write_look -> store_background).
_LOCK = threading.RLock()


def _locked(function):
    @wraps(function)
    def run(*args, **kwargs):
        with _LOCK:
            return function(*args, **kwargs)
    return run


IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
BACKGROUNDS = ("blur", "color", "image")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
DEFAULT_LOOK = {"background": "blur", "blur": 33, "color": "#000000", "image": None,
                "radius": 0, "spacing": 0, "tracking": True, "no_track": [], "subjects": [],
                "transform": None}   # Transform video: {x, y, scale, crop[4]} ឬ None = AI layout
SUBJECTS_MAX = 200          # ផ្លូវដោយដៃក្នុងមួយ project (មួយក្នុងមួយ scene)


def clean_look(look: dict) -> dict:
    """ការកំណត់ Background / Tracker ដែលត្រឹមត្រូវ (ចំនួនត្រូវបង្ខាំងក្នុងដែន). `ValueError` បើខុស.

    ឧ. {"background": "color", "color": "#1E8F5A", "blur": 500} -> blur 100, color ដដែល.
    """
    out = {**DEFAULT_LOOK, **{k: v for k, v in look.items() if k in DEFAULT_LOOK and v is not None}}
    if out["background"] not in BACKGROUNDS:
        raise ValueError(f"background ត្រូវជា {', '.join(BACKGROUNDS)}")
    if not HEX_COLOR.match(str(out["color"])):
        raise ValueError("color ត្រូវជា #RRGGBB")
    if out["background"] == "image" and not out["image"]:
        raise ValueError("background image ត្រូវការរូប")
    out["blur"] = max(0, min(100, int(out["blur"])))
    out["radius"] = max(0, min(200, int(out["radius"])))
    out["spacing"] = max(0, min(20, int(out["spacing"])))
    out["tracking"] = bool(out["tracking"])
    out["no_track"] = sorted([round(float(a), 3), round(float(b), 3)]
                             for a, b in out["no_track"] if float(b) > float(a))
    # Manual subject tracking: Track.as_dict() មួយក្នុងមួយ scene — អានវាឡើងវិញ ដើម្បីត្រួតពិនិត្យ
    from pipeline.subject_track import Track
    try:
        subjects = [Track.from_dict(item).as_dict() for item in out["subjects"][:SUBJECTS_MAX]]
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"subjects ខុសទម្រង់: {error}") from error
    out["subjects"] = sorted(subjects, key=lambda item: item["start"])
    out["transform"] = clean_transform(out["transform"])
    return out


def clean_transform(value) -> dict | None:
    """Transform video ពី UI -> {x, y, scale, crop} ដែលត្រឹមត្រូវ (pipeline.transform.parse ពិនិត្យ).

    ឧ. {"x": 0.5, "y": 0.42, "scale": 1.1, "crop": [0.14, 0, 0.72, 1]}. None = AI layout.
    """
    if value is None:
        return None
    from pipeline.transform import TransformError, parse
    if not isinstance(value, dict):
        raise ValueError("transform ត្រូវជា {x, y, scale, crop}")
    try:
        crop = value.get("crop") or [0, 0, 1, 1]
        parsed = parse(f"{float(value['x'])},{float(value['y'])},{float(value['scale'])}",
                       ",".join(str(float(v)) for v in crop))
    except (KeyError, TypeError) as error:
        raise ValueError(f"transform ខុសទម្រង់: {error}") from error
    except TransformError as error:
        raise ValueError(str(error)) from error
    return {"x": round(parsed.x, 4), "y": round(parsed.y, 4), "scale": round(parsed.scale, 4),
            "crop": [round(v, 4) for v in parsed.crop]}


def store_background(folder: Path, image: str | Path) -> Path:
    """ចម្លងរូប background ចូល `output/<name>/background.<ext>` — រូបដើមមិនត្រូវបានប៉ះ.

    រូបដែលនៅក្នុង folder រួចហើយ (រក្សាទុកពីមុន) មិនចម្លងម្តងទៀតទេ.
    """
    source = Path(image)
    if source.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError(f"រូបត្រូវជា {', '.join(IMAGE_SUFFIXES)}")
    if not source.is_file():
        raise FileNotFoundError(f"រករូបមិនឃើញ: {source}")
    folder = Path(folder)
    if source.parent.resolve() == folder.resolve() and source.stem == "background":
        return source
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("background.*"):          # រូបចាស់ផ្សេង extension
        old.unlink(missing_ok=True)
    target = folder / f"background{source.suffix.lower()}"
    shutil.copyfile(source, target)
    return target


def read_look(folder: Path) -> dict:
    """Background / Tracker ដែល Edit Video រក្សាទុក (លំនាំដើម បើគ្មាន ឬខូច)."""
    data = _read(folder).get("look")
    try:
        look = clean_look(data) if isinstance(data, dict) else dict(DEFAULT_LOOK)
    except (ValueError, TypeError):
        look = dict(DEFAULT_LOOK)
    if look["image"] and not Path(look["image"]).is_file():      # រូបត្រូវបានលុបពី folder
        look["image"] = None
        if look["background"] == "image":
            look["background"] = "blur"
    return look


@_locked
def write_look(folder: Path, look: dict) -> dict:
    """រក្សាទុក (រូបចម្លងចូល folder មុន). លំនាំដើមទាំងអស់ = លុប key ចេញពី project.json."""
    look = clean_look(look)
    if look["image"]:
        look["image"] = str(store_background(folder, look["image"]))
    data = _read(folder)
    data["look"] = None if look == DEFAULT_LOOK else look
    _write(folder, data)
    return look


def look_options(look: dict) -> dict:
    """look -> option របស់ job (ឈ្មោះដូច flag CLI); តម្លៃលំនាំដើមមិនត្រូវផ្ញើ."""
    options: dict = {}
    if look["background"] != "blur":
        options["fit_background"] = look["background"]
    if look["blur"] != DEFAULT_LOOK["blur"]:
        options["fit_blur"] = look["blur"]
    if look["background"] == "color":
        options["fit_color"] = look["color"]
    if look["background"] == "image":
        options["fit_image"] = look["image"]
    if look["radius"]:
        options["fit_radius"] = look["radius"]
    if look["spacing"]:
        options["fit_spacing"] = look["spacing"]
    if not look["tracking"]:
        options["no_tracking"] = True
    if look["transform"]:
        t = look["transform"]
        options["transform"] = f"{t['x']:g},{t['y']:g},{t['scale']:g}"
        if t["crop"] != [0, 0, 1, 1]:
            options["transform_crop"] = ",".join(f"{v:g}" for v in t["crop"])
    return options


DEFAULT_MOTION = {"zoom": "off", "zoom_amount": 8, "keywords": 0, "shake": "off", "animation": "pop"}


def clean_motion(motion: dict) -> dict:
    """ការកំណត់ផ្ទាំង Motion ដែលត្រឹមត្រូវ — ចំនួនត្រូវបង្ខាំង, ពាក្យខុស = `ValueError`.

    ឧ. {"zoom": "in", "zoom_amount": 50} -> zoom_amount 20.
    """
    import config

    out = {**DEFAULT_MOTION, **{k: v for k, v in motion.items() if k in DEFAULT_MOTION and v is not None}}
    if out["zoom"] not in ("off", "in", "out"):
        raise ValueError("zoom ត្រូវជា off, in ឬ out")
    if out["shake"] not in ("off", "loud", "all"):
        raise ValueError("shake ត្រូវជា off, loud ឬ all")
    if out["animation"] not in config.CAPTION_ANIMATIONS:
        raise ValueError(f"animation ត្រូវជា {', '.join(config.CAPTION_ANIMATIONS)}")
    out["zoom_amount"] = max(1, min(20, int(out["zoom_amount"])))
    out["keywords"] = max(0, min(20, int(out["keywords"])))
    return out


def read_motion(folder: Path) -> dict:
    """Motion ដែល Edit Video រក្សាទុក (លំនាំដើម បើគ្មាន ឬខូច)."""
    data = _read(folder).get("motion")
    try:
        return clean_motion(data) if isinstance(data, dict) else dict(DEFAULT_MOTION)
    except (ValueError, TypeError):
        return dict(DEFAULT_MOTION)


@_locked
def write_motion(folder: Path, motion: dict) -> dict:
    """រក្សាទុក Motion ក្នុង project.json (លំនាំដើម = លុប key) — look, cuts, title នៅដដែល."""
    motion = clean_motion(motion)
    data = _read(folder)
    data["motion"] = None if motion == DEFAULT_MOTION else motion
    _write(folder, data)
    return motion


def motion_options(motion: dict) -> dict:
    """Motion -> option របស់ job (ឈ្មោះដូច flag CLI); តម្លៃលំនាំដើមមិនផ្ញើ."""
    options: dict = {}
    if motion["zoom"] != "off":
        options["motion_zoom"] = motion["zoom"]
        if motion["zoom_amount"] != DEFAULT_MOTION["zoom_amount"]:
            options["motion_zoom_amount"] = motion["zoom_amount"]
    if motion["keywords"]:
        options["motion_keywords"] = motion["keywords"]
    if motion["shake"] != "off":
        options["motion_shake"] = motion["shake"]
    if motion["animation"] != "pop":
        options["caption_animation"] = motion["animation"]
    return options


def subject_scene(look: dict, scene: list[float]) -> dict:
    """look ដែលផ្លូវរបស់ scene នេះត្រូវដកចេញ (Reset ក្នុង dialog) ហើយ scene នេះត្រូវបើក tracking វិញ."""
    start, end = scene
    return {**look,
            "subjects": [item for item in look["subjects"] if not (item["start"] < end and item["end"] > start)],
            "no_track": [pair for pair in look["no_track"] if not (pair[0] < end and pair[1] > start)]}


RATINGS = ("like", "dislike")


def _read(folder: Path) -> dict:
    """project.json ទាំងមូល ({"title", "ratings"}); {} បើគ្មាន ឬ file ខូច."""
    try:
        data = json.loads((Path(folder) / TITLE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(folder: Path, data: dict) -> None:
    """សរសេរ project.json — លុប key ទទេ ហើយលុប file បើគ្មានអ្វីនៅសល់.

    **atomic**: សរសេរ `.tmp` រួច `os.replace` ម្តង. `write_text` ផ្ទាល់ធ្វើឲ្យ file ទទេមួយភ្លែត
    ហើយ thread ផ្សេងដែលអានពេលនោះ ឃើញ {} — វាបានលុប cuts/splits របស់អ្នកអភិវឌ្ឍ (វាស់ 2026-10-27).
    """
    path = Path(folder) / TITLE_FILE
    data = {key: value for key, value in data.items() if value}
    if not data:
        path.unlink(missing_ok=True)
        return
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)



def read_title(folder: Path) -> str | None:
    """ឈ្មោះបង្ហាញ ឬ None បើមិនធ្លាប់ប្តូរ (ឬ file ខូច)."""
    title = _read(folder).get("title")
    return title.strip() if isinstance(title, str) and title.strip() else None


@_locked
def write_title(folder: Path, title: str) -> str | None:
    """សរសេរឈ្មោះបង្ហាញ; ឈ្មោះទទេ = ត្រឡប់ទៅឈ្មោះ folder វិញ. ការវាយតម្លៃ clip នៅដដែល."""
    title = " ".join(title.split())[:TITLE_MAX]      # ដកដកឃ្លាលើស និងបន្ទាត់ថ្មី
    data = _read(folder)
    data["title"] = title
    _write(folder, data)
    return title or None


def rating_key(start: float, end: float) -> str:
    """clip ត្រូវស្គាល់តាម**ចន្លោះពេល** មិនមែនលេខទេ: បើ AI ជ្រើសម្តងទៀត clip #1 អាចជា clip ផ្សេង."""
    return f"{start:.1f}-{end:.1f}"


MAX_SPLITS = 2000
MAX_INSERTS = 200
INSERT_MIN_SEC = 0.1   # ដូច cuts.MIN_KEEP_SEC: ផ្នែកខ្លីជាងនេះ pipeline មិនយក


def clean_inserts(items) -> list[dict]:
    """ផ្នែកដែលបន្ថែម ("+ Extend a clip" -> Add): `[{"start", "end", "at"}, ...]` ពេលក្នុងវីដេអូដើម.

    រក្សាលំដាប់ (inserts ដែល `at` ដូចគ្នា ចាក់តាមលំដាប់នេះ — `cuts.sequence`). ផ្នែកខ្លីជាង
    INSERT_MIN_SEC, ពេលអវិជ្ជមាន ឬ dict ខុសទម្រង់ = ValueError (400), មិនមែនដកស្ងាត់ៗទេ.
    """
    if not isinstance(items, list):
        raise ValueError("inserts ត្រូវជាបញ្ជី")
    if len(items) > MAX_INSERTS:
        raise ValueError(f"inserts ច្រើនពេក (អតិបរមា {MAX_INSERTS})")
    out: list[dict] = []
    for item in items:
        try:
            start, end, at = (round(float(item[key]), 3) for key in ("start", "end", "at"))
        except (KeyError, TypeError, ValueError):
            raise ValueError("insert នីមួយៗត្រូវជា {start, end, at}") from None
        if start < 0 or at < 0 or end - start < INSERT_MIN_SEC:
            raise ValueError(f"insert ខុស: start {start}, end {end}, at {at}")
        out.append({"start": start, "end": end, "at": at})
    return out


def clean_order(items) -> list[list[float]]:
    """ប្លុកតាមលំដាប់ចេញ (អូសលើ timeline): `[[start, end], ...]` ពេលក្នុងវីដេអូដើម.

    លំដាប់ពេលធម្មតា = `[]`: វាមិនផ្ទុកព័ត៌មានអ្វីទេ (`cuts.rearrange` ឲ្យលទ្ធផលដដែល) ដូច្នេះ
    "បានប្តូរលំដាប់ឬទេ" = បញ្ជីមិនទទេ. ទម្រង់ខុស = ValueError (400).
    """
    if not isinstance(items, list):
        raise ValueError("order ត្រូវជាបញ្ជី")
    if len(items) > MAX_SPLITS + 1:
        raise ValueError(f"order ច្រើនពេក (អតិបរមា {MAX_SPLITS + 1})")
    out: list[list[float]] = []
    for item in items:
        try:
            start, end = (round(float(value), 3) for value in item)
        except (TypeError, ValueError):
            raise ValueError("ប្លុកនីមួយៗត្រូវជា [start, end]") from None
        if start < 0 or end - start < INSERT_MIN_SEC:
            raise ValueError(f"ប្លុកខុស: start {start}, end {end}")
        out.append([start, end])
    return [] if out == sorted(out) else out


def read_cuts(folder: Path) -> dict:
    """cut list ដែល editor រក្សាទុក: `{"cuts": [[start, end], ...], "transition": "punch", "splits": [10.2, ...],
    "inserts": [{"start", "end", "at"}, ...], "order": [[start, end], ...]}`.

    `order` = លំដាប់ប្លុកដែលអូសលើ timeline; `[]` = លំដាប់ពេលធម្មតា.

    `splits` = ចំណុចបំបែកលើ timeline (ប៊ូតុង Split): វាមិនកាត់អ្វីទេ — វាគ្រាន់តែចែក timeline ជាផ្នែក
    ដើម្បីជ្រើសផ្នែកមួយលុប. ការលុបពិតនៅតែជា `cuts`. `inserts` = ផ្នែកដែលចម្លងទៅដាក់នៅពេល `at`
    (0 = hook នៅដើម) — ផ្នែកដែលបានកាត់ ហើយ Add នៅកន្លែងដើម គ្រាន់តែចេញពី `cuts`, មិនមែន insert ទេ.
    """
    data = _read(folder).get("edit")
    if not isinstance(data, dict):
        return {"cuts": [], "transition": "punch", "splits": [], "inserts": [], "order": []}
    cuts =[[float(a), float(b)] for a, b in data.get("cuts", []) if float(b) > float(a)]
    splits = sorted({float(at) for at in data.get("splits", []) if float(at) > 0})
    try:
        inserts = clean_inserts(data.get("inserts", []))
    except ValueError:
        inserts = []   # file ដែលកែដោយដៃខុស — មិនឲ្យ editor បើកមិនបាន
    try:
        order = clean_order(data.get("order", []))
    except ValueError:
        order = []
    return {"cuts": cuts, "transition": data.get("transition") or "punch", "splits": splits, "inserts": inserts,
            "order": order}


@_locked
def write_cuts(folder: Path, cuts: list[list[float]], transition: str = "punch",
               splits: list[float] | None = None, inserts: list[dict] | None = None,
               order: list[list[float]] | None = None) -> dict:
    """រក្សាទុក cut list (ទទេ ហើយគ្មាន split / insert / order = លុបវា). ឈ្មោះ និងការវាយតម្លៃនៅដដែល.

    `splits=None` / `inserts=None` / `order=None` = ទុកអ្វីដែលមានស្រាប់ (job ឬ UI ចាស់ដែលមិនស្គាល់វា).
    """
    from pipeline.cuts import TRANSITIONS
    if transition not in TRANSITIONS:
        raise ValueError(f"transition ត្រូវជា {', '.join(TRANSITIONS)}: {transition}")
    clean = sorted([round(float(a), 3), round(float(b), 3)] for a, b in cuts if float(b) > float(a))
    if splits is None:
        points = read_cuts(folder)["splits"]
    else:
        points = sorted({round(float(at), 3) for at in splits if float(at) > 0})
        if len(points) > MAX_SPLITS:
            raise ValueError(f"split ច្រើនពេក (អតិបរមា {MAX_SPLITS})")
    added = read_cuts(folder)["inserts"] if inserts is None else clean_inserts(inserts)
    blocks = read_cuts(folder)["order"] if order is None else clean_order(order)
    data = _read(folder)
    edit: dict = {"cuts": clean, "transition": transition}
    if points:
        edit["splits"] = points
    if added:
        edit["inserts"] = added
    if blocks:
        edit["order"] = blocks
    data["edit"] = edit if clean or points or added or blocks else None
    _write(folder, data)
    return {"cuts": clean, "transition": transition, "splits": points, "inserts": added, "order": blocks}


def read_ratings(folder: Path) -> dict[str, str]:
    """{"125.3-141.0": "like", ...} — ♡ / 👎 លើទំព័រ Review."""
    ratings = _read(folder).get("ratings")
    if not isinstance(ratings, dict):
        return {}
    return {key: value for key, value in ratings.items() if value in RATINGS}


@_locked
def write_rating(folder: Path, start: float, end: float, rating: str | None) -> None:
    """កំណត់ ឬលុប (None) ការវាយតម្លៃ clip មួយ. ឈ្មោះបង្ហាញនៅដដែល."""
    if rating is not None and rating not in RATINGS:
        raise ValueError(f"rating ត្រូវជា like ឬ dislike: {rating}")
    data = _read(folder)
    ratings = read_ratings(folder)
    key = rating_key(start, end)
    if rating is None:
        ratings.pop(key, None)
    else:
        ratings[key] = rating
    data["ratings"] = ratings
    _write(folder, data)


# PowerShell ប្រើ .NET `FileSystem.DeleteDirectory(..., SendToRecycleBin)` ដែល Windows មានស្រាប់
# — មិនបាច់ដំឡើង package ថ្មី។ path ចូលតាម env var មិនមែនក្នុង command ទេ ដូច្នេះ quote
# ឬ `$` ក្នុងឈ្មោះ folder មិនអាចប្តូរ command បានទេ។
RECYCLE_COMMAND = (
    "Add-Type -AssemblyName Microsoft.VisualBasic; "
    "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("
    "$env:CLIPFORGE_RECYCLE, 'OnlyErrorDialogs', 'SendToRecycleBin')"
)


def recycle(folder: Path) -> None:
    """ផ្ញើ folder ទៅ Recycle Bin។ បោះ `OSError` បើវានៅតែមាន."""
    folder = Path(folder)
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", RECYCLE_COMMAND],
        env={**os.environ, "CLIPFORGE_RECYCLE": str(folder)},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if folder.exists():
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise OSError(detail[-1] if detail else "ផ្ញើទៅ Recycle Bin មិនបាន")
