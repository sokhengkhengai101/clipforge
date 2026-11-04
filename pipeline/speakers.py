"""ដាក់អ្នកកំពុងនិយាយនៅផ្ទាំងលើរបស់ Split (`--speaker-top`).

យើងគ្មាន diarization ទេ: រាល់ frame យើងវាស់ថាមាត់ប្តូរប៉ុន្មាន ហើយដកចលនាតំបន់ភ្នែកចេញ
(ភ្នែកតំណាងឲ្យក្បាល ដូច្នេះការងក់ក្បាលមិនរាប់ថានិយាយ)។ រាល់វិនាទីដែល transcript មានពាក្យ
មុខដែលពិន្ទុខ្ពស់ជាងគេ = អ្នកនិយាយ។

ដែនកំណត់: បរិភោគ ឬសើច ក៏ធ្វើឲ្យមាត់កម្រើកដែរ។ `hold_runs` លុបបានតែការលោតខ្លី (ខ្លីជាង
`SPEAKER_MIN_SEC`) មិនមែនការសើចយូរទេ។
"""

import subprocess
from pathlib import Path

import cv2
import numpy as np

import config
from pipeline.reframe import (Layout, Segment, detect_faces, detect_faces_in_frame, single_box,
                              tracked_box, tracking_allowed)

FPS = 10
PATCH_PX = 32            # មាត់គ្រប់ទំហំបង្រួមមកទំហំនេះ ដើម្បីកុំឲ្យមុខធំបានពិន្ទុខ្ពស់ជាង
PATCH_FACE_RATIO = 0.28  # ពាក់កណ្តាលទទឹងតំបន់មាត់ ធៀបនឹងទទឹងមុខ
TALK_MIN_TENTHS = 3      # វិនាទីមួយរាប់ថា "មានការនិយាយ" បើមានពាក្យយ៉ាងតិច 3 ក្នុង 10 ចំណុច


def hold_runs(picks: list[int | None], min_sec: int | None = None) -> list[int] | None:
    """បម្លែងអ្នកនិយាយរាល់វិនាទី ទៅជាបញ្ជីដែលមិនលោតញឹក. `None` = គ្មានភស្តុតាងទាល់តែសោះ.

    ឧទាហរណ៍ (min_sec=2): [0,0,1,0,0] -> [0,0,0,0,0], ប៉ុន្តែ [1,1,0,0] នៅដដែល។
    វិនាទីស្ងាត់ (`None`) យកអ្នកនិយាយមុន; វិនាទីស្ងាត់ដំបូងយកអ្នកនិយាយដំបូង។
    """
    min_sec = config.SPEAKER_MIN_SEC if min_sec is None else min_sec
    known = [p for p in picks if p is not None]
    if not known:
        return None

    filled, last = [], known[0]
    for pick in picks:
        last = last if pick is None else pick
        filled.append(last)

    # ចែកជាក្រុមជាប់គ្នា [អ្នកនិយាយ, ប្រវែង] រួចលុបក្រុមខ្លីទៅក្នុងក្រុមមុន
    runs: list[list[int]] = []
    for pick in filled:
        if runs and runs[-1][0] == pick:
            runs[-1][1] += 1
        else:
            runs.append([pick, 1])
    kept: list[list[int]] = []
    for who, length in runs:
        if length < min_sec and kept:
            kept[-1][1] += length
        elif kept and kept[-1][0] == who:
            kept[-1][1] += length
        else:
            kept.append([who, length])
    # ក្រុមដំបូងខ្លីពេក គ្មានក្រុមមុនឲ្យចូល -> ចូលក្រុមបន្ទាប់
    if len(kept) > 1 and kept[0][1] < min_sec:
        kept[1][1] += kept[0][1]
        kept.pop(0)
    return [who for who, length in kept for _ in range(length)]


def panel_of(face_cx: float, panels: list) -> int | None:
    """មុខនេះជារបស់ផ្ទាំងណា: ផ្ទាំងដែលកណ្តាលជិតជាងគេ ហើយមុខនៅក្នុងប្រអប់វា."""
    inside = [i for i, box in enumerate(panels) if box.x <= face_cx <= box.x + box.w]
    if not inside:
        return None
    return min(inside, key=lambda i: abs(panels[i].x + panels[i].w / 2 - face_cx))


def _frames(video: Path, start: float, end: float, size: tuple[int, int]):
    width, height = size
    command = ["ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
               "-i", str(video), "-vf", f"fps={FPS},scale={width}:{height}",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            raw = process.stdout.read(width * height * 3)
            if len(raw) < width * height * 3:
                return
            yield np.frombuffer(raw, np.uint8).reshape(height, width, 3).copy()
    finally:
        process.kill()
        process.wait()


def _patch(gray, cx: float, cy: float, half: float):
    height, width = gray.shape
    x0, y0, x1, y1 = int(cx - half), int(cy - half), int(cx + half), int(cy + half)
    if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 <= x0 or y1 <= y0:
        return None
    return cv2.resize(gray[y0:y1, x0:x1], (PATCH_PX, PATCH_PX)).astype(np.float32)


def mouth_scores(video: Path, start: float, end: float, size: tuple[int, int],
                 panels: list) -> list[list[float]]:
    """ពិន្ទុរាល់វិនាទី ក្នុងមួយផ្ទាំង: បញ្ជីនៃ [ពិន្ទុផ្ទាំង 0, ពិន្ទុផ្ទាំង 1, ...] (nan = គ្មានមុខ)."""
    samples: list[list[list[float]]] = []
    previous: dict[int, tuple] = {}
    for index, frame in enumerate(_frames(video, start, end, size)):
        second = index // FPS
        while len(samples) <= second:
            samples.append([[] for _ in panels])
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        seen: set[int] = set()
        # មុខធំមុន: បើពីរមុខធ្លាក់ក្នុងផ្ទាំងតែមួយ យកមុខធំ (អ្នកដែលផ្ទាំងនោះ frame)
        for face in sorted(detect_faces_in_frame(frame, size), key=lambda f: f.w, reverse=True):
            panel = panel_of(face.cx, panels)
            if panel is None or panel in seen or len(face.landmarks) < 10:
                continue
            seen.add(panel)
            lm, half = face.landmarks, face.w * PATCH_FACE_RATIO
            mouth = _patch(gray, (lm[6] + lm[8]) / 2, (lm[7] + lm[9]) / 2, half)
            eyes = _patch(gray, (lm[0] + lm[2]) / 2, (lm[1] + lm[3]) / 2, half)
            before = previous.get(panel)
            if mouth is not None and eyes is not None and before is not None:
                samples[second][panel].append(
                    float(np.abs(mouth - before[0]).mean() - np.abs(eyes - before[1]).mean()))
            previous[panel] = (mouth, eyes) if mouth is not None and eyes is not None else None
        # មុខបាត់មួយ frame -> កុំប្រៀបធៀបជាមួយ frame ចាស់ពេល (ក្បាលបានប្តូររួចហើយ)
        for panel in set(previous) - seen:
            previous[panel] = None
    return [[float(np.mean(values)) if values else float("nan") for values in second]
            for second in samples]


def pick_per_second(scores: list[list[float]], start: float, words: list) -> list[int | None]:
    """អ្នកនិយាយរាល់វិនាទី: ពិន្ទុខ្ពស់ជាងគេ តែក្នុងវិនាទីដែល transcript មានពាក្យ."""
    picks: list[int | None] = []
    for second, values in enumerate(scores):
        moment = start + second
        tenths = sum(any(w.start <= moment + j / 10 <= w.end for w in words) for j in range(10))
        usable = [i for i, v in enumerate(values) if not np.isnan(v)]
        if len(usable) == 1:
            # ផ្ទាំងគ្មានមុខមិនត្រូវឡើងលើឡើយ (clip 3: ក្បាលបុរសចេញក្រៅប្រអប់ 4 s ហើយផ្ទាំងលើ
            # បង្ហាញតែស្មា ខណៈនារីកំពុងនិយាយ) ទោះមុខដែលនៅសល់មិនទាន់បញ្ជាក់ថានិយាយក៏ដោយ
            picks.append(usable[0])
        elif tenths < TALK_MIN_TENTHS or not usable:
            picks.append(None)
        else:
            picks.append(int(np.nanargmax(values)))
    return picks


def snap_to_gap(moment: float, words: list, reach: float | None = None) -> float:
    """រំកិលការកាត់ទៅចន្លោះពាក្យដែលជិតជាងគេ — ផ្ទាំងមិនប្តូរកណ្តាលពាក្យ.

    គ្មានចន្លោះក្នុងចម្ងាយ `reach` វិនាទី -> ទុកពេលដើម។
    """
    reach = config.SPEAKER_SNAP_SEC if reach is None else reach
    gaps = [(a.end + b.start) / 2 for a, b in zip(words, words[1:])]
    near = [gap for gap in gaps if abs(gap - moment) <= reach]
    return min(near, key=lambda gap: abs(gap - moment)) if near else moment


def speaker_segments(segment: Segment, picks: list[int], words: list | None = None) -> list[Segment]:
    """ចែក shot តាមអ្នកនិយាយ: ផ្ទាំងអ្នកនិយាយឡើងលើ ហើយកាត់ចន្លោះពាក្យពេលអ្នកនិយាយប្តូរ."""
    layout = segment.layout
    pieces: list[Segment] = []
    begin, begin_at = 0, segment.start
    for second in range(1, len(picks) + 1):
        if second < len(picks) and picks[second] == picks[begin]:
            continue
        top = picks[begin]
        panels = [layout.panels[top], layout.panels[1 - top]]
        end_at = (segment.end if second == len(picks)
                  else snap_to_gap(segment.start + second, words or []))
        pieces.append(Segment(
            start=begin_at, end=end_at,
            layout=Layout(kind=layout.kind, panels=panels, box=layout.box, person=layout.person),
        ))
        begin, begin_at = second, end_at
    return pieces


def only_visible_panel(scores: list[list[float]]) -> int | None:
    """ផ្ទាំងដែលនៅមានមុខ ពេលផ្ទាំងម្ខាងទៀតគ្មានមុខជាងពាក់កណ្តាល shot. `None` = នៅជា Split ដដែល."""
    if not scores:
        return None
    present = [sum(not np.isnan(second[panel]) for second in scores) / len(scores)
               >= config.FACE_PRESENCE_MIN for panel in range(len(scores[0]))]
    return present.index(True) if present.count(True) == 1 else None


def single_on_panel(video: Path, segment: Segment, size: tuple[int, int], panel: int) -> Segment:
    """បម្លែង Split ទៅ Fill លើអ្នកដែលនៅក្នុងរូប ដោយ crop តាមគាត់ (គាត់អាចរំកិលក្នុង shot)."""
    middle = (segment.start + segment.end) / 2
    faces = [f for f in detect_faces(video, middle, size)
             if panel_of(f.cx, segment.layout.panels) == panel]
    if faces and tracking_allowed(segment.start, segment.end):
        box = tracked_box(video, segment.start, segment.end, size, max(faces, key=lambda f: f.w))
    elif faces:
        box = single_box(max(faces, key=lambda f: f.w), *size)
    else:
        box = segment.layout.box
    return Segment(segment.start, segment.end, Layout(kind="single", box=box))


def place_speakers(video: Path, segments: list[Segment], size: tuple[int, int],
                   words: list) -> list[Segment]:
    """ដំណើរការលើ `split` តែប៉ុណ្ណោះ; shot គ្មានភស្តុតាង រក្សាលំដាប់ផ្ទាំងចាស់."""
    placed: list[Segment] = []
    for segment in segments:
        if segment.layout.kind != "split" or len(segment.layout.panels) != 2:
            placed.append(segment)
            continue
        near = [w for w in words if w.end >= segment.start and w.start <= segment.end]
        scores = mouth_scores(video, segment.start, segment.end, size, segment.layout.panels)
        # ម្នាក់ចេញក្រៅរូបដើមភាគច្រើននៃ shot: គ្មាន crop ណាបង្ហាញគាត់បានទេ ផ្ទាំងគាត់នឹងទទេ
        visible = only_visible_panel(scores)
        if visible is not None:
            placed.append(single_on_panel(video, segment, size, visible))
            continue
        picks = hold_runs(pick_per_second(scores, segment.start, near))
        placed.extend(speaker_segments(segment, picks, near) if picks else [segment])
    return placed
