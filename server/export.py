"""ចម្លង clip ចេញទៅ folder ដែលអ្នកប្រើជ្រើស (screen 05 · Export).

ហេតុអ្វីត្រូវចម្លង ហើយមិនឲ្យអ្នកប្រើទៅយកក្នុង `output/` ដោយខ្លួនឯង? ពីរមូលហេតុ៖
`clip_01.mp4` គ្មានន័យអ្វីនៅលើទូរស័ព្ទ ឬក្នុង folder រួមមួយ, ហើយ file ក្នុង
`output/` ត្រូវសរសេរជាថ្មីរាល់ពេល `--redo render` រត់។ Export ផ្តល់ឈ្មោះអានបាន
(`01 - Title.mp4`) និង file ដែលនៅដូចដើមទោះ pipeline រត់ម្តងទៀត។

គោលការណ៍៖ យើង **មិនដែលសរសេរពីលើ** file ដែលមានស្រាប់ទេ — ឈ្មោះដែលជាន់គ្នា
ទទួលបាន ` (2)` ជំនួស, ដូច Windows ធ្វើពេល copy។ ហើយ file ដើមមិនត្រូវប៉ះ:
`shutil.copy2` អាន source ហើយសរសេរ target ថ្មី។
"""

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Windows បដិសេធតួអក្សរទាំងនេះក្នុងឈ្មោះ file; \x00-\x1f ជាតួអក្សរបញ្ជា
# (control characters) ដែលមិនត្រូវមានក្នុងឈ្មោះ file លើប្រព័ន្ធណាក៏ដោយ។
ILLEGAL = re.compile(r'[<>:"/\|?*\x00-\x1f]')

MAX_TITLE = 60          # ឈ្មោះវែងពេកធ្វើឲ្យ path លើស 260 តួ (ដែន Windows)


def default_destination(project: str) -> Path:
    """កន្លែងដែល Export ស្នើជាលំនាំដើម — `~/Videos/ClipForge/<project>/`.

    UI ត្រូវបង្ហាញ path នេះ **មុន** ពេលចុច Export ដូច្នេះវាត្រូវគណនានៅទីនេះ
    កន្លែងតែមួយ, មិនមែនម្តងក្នុង Python ម្តងក្នុង TypeScript.
    """
    return Path.home() / "Videos" / "ClipForge" / (safe_part(project) or "clips")


def safe_part(text: str) -> str:
    """ប្តូរ title ជាអ្វីដែល Windows ទទួលយកជាឈ្មោះ file.

    ឧ. `"Why "AI" fails: part 2"` -> `"Why AI fails part 2"`. ចុងបញ្ចប់ដែលជា
    `.` ឬ space ត្រូវកាត់ចោល ព្រោះ Windows បោះវាចោលស្ងាត់ៗ ហើយយើងនឹងបាត់
    track ថា file ឈ្មោះអ្វីពិត.
    """
    clean = ILLEGAL.sub("", text).strip()
    return clean[:MAX_TITLE].strip().rstrip(". ")


def export_name(clip: dict, kind: str) -> str:
    """`01 - Daily Rhino Monitoring.mp4`. លេខនៅខាងមុខ ដូច្នេះការ sort តាមឈ្មោះ
    = លំដាប់ ranking; clip ដែលគ្មាន title ត្រឡប់ទៅ `clip_01.mp4`."""
    title = safe_part(clip.get("title") or "")
    stem = f"{clip['index']:02d} - {title}" if title else f"clip_{clip['index']:02d}"
    return f"{stem}.{kind}"


def free_path(folder: Path, name: str) -> Path:
    """path ដែលមិនទាន់មាន — `X (2).mp4` បើ `X.mp4` មានរួច."""
    target = folder / name
    if not target.exists():
        return target
    for number in range(2, 100):
        candidate = folder / f"{target.stem} ({number}){target.suffix}"
        if not candidate.exists():
            return candidate
    # ១០០ ឈ្មោះដូចគ្នា — កម្រណាស់, តែយើងមិនត្រូវសរសេរពីលើឡើយ
    return folder / f"{target.stem} ({int(time.time())}){target.suffix}"


def plan(clips: list[dict], indexes: list[int] | None = None,
         kinds: tuple[str, ...] = ("mp4",)) -> list[dict]:
    """អ្វីដែល export **នឹង** សរសេរ — ឈ្មោះថ្មី និងទំហំ.

    Function តែមួយបម្រើទាំងការបង្ហាញជាមុន (GET, មិនប៉ះ disk) ទាំងការចម្លងពិត
    (POST), ដូច្នេះអ្វីដែល UI បង្ហាញ និងអ្វីដែលកើតឡើងពិតមិនអាចខុសគ្នា.
    """
    wanted = None if indexes is None else set(indexes)
    items = []
    for clip in clips:
        if wanted is not None and clip["index"] not in wanted:
            continue
        files = []
        for kind in kinds:
            source = clip.get("files", {}).get(kind)
            if not source or not Path(source).is_file():
                continue            # clip មិនទាន់ render ឬគ្មាន sidecar នោះ
            path = Path(source)
            # ទាំង bytes ទាំង mb: `.srt` មានតែប៉ុន្មាន KB ហើយ `round(.., 2)`
            # ធ្វើឲ្យវាក្លាយជា "0.0 MB" ក្នុង UI — UI រៀបចំអង្គភាពពី bytes.
            size = path.stat().st_size
            files.append({
                "kind": kind,
                "source": str(path),
                "name": export_name(clip, kind),
                "bytes": size,
                "mb": round(size / 1e6, 2),
            })
        items.append({"index": clip["index"], "title": clip.get("title", ""),
                      "files": files})
    return items


def copy_plan(items: list[dict], destination: Path) -> dict:
    """ចម្លងតាម plan. file ណាចម្លងមិនបានមិនបញ្ឈប់ដំណើរការទេ — វាចូល `skipped`
    ជាមួយមូលហេតុ, ព្រោះ clip ៤ ក្នុង ៥ ល្អជាង error តែមួយហើយគ្មានអ្វីសោះ."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    written: list[dict] = []
    skipped: list[dict] = []
    for item in items:
        for file in item["files"]:
            target = free_path(destination, file["name"])
            try:
                shutil.copy2(file["source"], target)
            except OSError as e:
                # SameFileError (export ចូល output/ ខ្លួនឯង), disk ពេញ, សិទ្ធិ...
                skipped.append({**file, "index": item["index"], "reason": str(e)})
                continue
            written.append({**file, "index": item["index"], "path": str(target)})
    return {
        "destination": str(destination),
        "files": written,
        "skipped": skipped,
        "bytes": sum(file["bytes"] for file in written),
        "mb": round(sum(file["bytes"] for file in written) / 1e6, 2),
    }


def explorer_select(path: Path) -> str:
    """Command line ដែលបើក Explorer ហើយបន្លិច file — quote តែ path ប៉ុណ្ណោះ."""
    return f'explorer /select,"{path}"'


def reveal(path: Path) -> bool:
    """បើក folder ក្នុង File Explorer (ហើយបន្លិច file បើ path ជា file).

    `False` បើ path មិនមាន — UI ត្រូវដឹង ជាជាងបើក window ទទេ.
    """
    path = Path(path)
    if not path.exists():
        return False
    if sys.platform == "win32":
        if path.is_file():
            # `explorer /select,<path>` ត្រឡប់ exit code 1 ទោះជោគជ័យ ដូច្នេះ
            # យើងប្រើ Popen ហើយមិនពិនិត្យលទ្ធផល. ចំណាំ: គ្មាន space ក្រោយ `,`.
            # command ជា string មិនមែន list: list ធ្វើឲ្យ Python ដាក់ quote ជុំវិញ
            # "/select,C:\a b\c.mp4" ទាំងមូលពេល path មាន space ហើយ Explorer មិនយល់
            # ក៏បើក Documents ជំនួស (ឃើញពិត). Explorer ចង់បាន /select,"C:\a b\c.mp4".
            subprocess.Popen(explorer_select(path))
        else:
            os.startfile(path)                                  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)] if path.is_file()
                         else ["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path if path.is_dir() else path.parent)])
    return True
