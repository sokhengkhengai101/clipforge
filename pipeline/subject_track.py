"""Manual subject tracking (menu Tracker របស់ Edit Video): អ្នកចុចលើប្រធានបទ, crop តាមវា.

ដំណើរការ:
1. `pick_subject` — YOLOX រកមនុស្ស/សត្វនៅ frame ដែលចុច ហើយយកប្រអប់ដែលគ្របចំណុចនោះ.
2. `track_subject` — OpenCV `TrackerVit` តាមប្រអប់នោះ**ទៅមុខ**ដល់ចុង scene និង**ថយក្រោយ**
   ដល់ដើម scene (frame ក្នុងលំដាប់ផ្ទុយ). គ្មាន model (`models/object_tracking_vittrack_2023sep.onnx`)
   -> `TrackerMIL` (មានក្នុង cv2 ស្រាប់) ជាមួយការពិនិត្យ histogram.
3. reframe ប្រើផ្លូវនោះជា crop រំកិល (`manual_box`) ដូច face tracking ដែរ.

**ពេលណាឈប់?** MIL មិនដែលប្រាប់ថា "បាត់" ទេ (វាស់: 120 frame, lost 0 ទោះប្រអប់នៅលើស្មៅ) ហើយ
បាត់រមាសក្នុង 0.5 s ក្នុងឈុតរត់. ViT មាន score តែវាមិនគ្រប់គ្រាន់ម្នាក់ឯង: ក្នុងឈុតដដែល ប្រអប់វា
ក្លាយជា frame ទាំងមូល (660x375 នៃ 640x360) ខណៈ score នៅ 0.6-0.7. ដូច្នេះផ្លូវឈប់ពេល score ទាប
**ឬ**ប្រអប់ធំពេក (ធៀបនឹង frame / ប្រអប់ដើម) — crop នៅស្ងៀមពីចំណុចល្អចុងក្រោយ ប្រសើរជាងតាមធូលី.
"""

import math
from dataclasses import dataclass
from pathlib import Path

import config

TRACK_WIDTH = 640          # frame ត្រូវបង្រួមមុនតាម (MIL 82 ms/frame នៅ 640 រួមទាំង decode)
TRACK_FPS = 12.0           # តាម ១២ ដង/វិនាទី — ពាក់កណ្តាលនៃ 24 fps, crop នៅរលូនក្រោយ smoothing
MAX_FRAMES = 360           # scene វែង: ពង្រីកជំហាន ដើម្បីកុំឲ្យ frame ក្នុង memory លើសនេះ
SIMILARITY_MIN = 0.35      # MIL: histogram correlation ក្រោមនេះ = ប្រអប់លែងនៅលើប្រធានបទ
# ViT: score ក្រោមនេះ **៣ frame ជាប់គ្នា** = បាត់. ម្តងមិនគ្រប់ទេ: ចានបាយដែលវាតាមបានត្រឹមត្រូវ
# ធ្លាក់ទៅ 0.21-0.27 មួយភ្លែតៗ (វាស់លើ Table For Four 203.5 s) ខណៈមនុស្សនៅ 0.49-0.70
VIT_SCORE_MIN = 0.25
LOW_STREAK = 3
# ប្រអប់គ្របលើស 60% ផ្ទៃ ឬ 90% ទទឹង frame = លែងជាប្រធានបទ (ឈុតរមាសរត់: 660x375 នៃ 640x360).
# មិនធៀបនឹងប្រអប់ដើមទេ: វត្ថុដែលមកជិតកាមេរ៉ាធំឡើងពិតៗ (ចាន 90x90 -> 606x123)
BOX_AREA_MAX = 0.60
BOX_WIDTH_MAX = 0.90
FALLBACK_BOX = 0.25        # រកប្រធានបទមិនឃើញ -> ប្រអប់ការ៉េ 25% នៃកម្ពស់ជុំវិញចំណុចចុច


@dataclass
class Track:
    """ផ្លូវរបស់ប្រធានបទក្នុង scene មួយ (ពេល = វិនាទីក្នុងវីដេអូ, ទីតាំង = pixel នៃរូបដើម)."""

    start: float                      # scene
    end: float
    box: tuple[int, int, int, int]    # ប្រអប់ដំបូង (x, y, w, h) នៅពេលចុច
    label: str                        # ប្រភេទពី YOLOX ឬ "area" (រកមិនឃើញ)
    points: list[tuple[float, float, float]]   # (ពេល, cx, cy)
    good_from: float                  # ផ្លូវល្អចាប់ពី...ដល់... (ក្រៅនោះ = ស្ងៀម)
    good_until: float

    def as_dict(self) -> dict:
        return {"start": self.start, "end": self.end, "box": list(self.box), "label": self.label,
                "points": [[round(t, 3), round(x, 1), round(y, 1)] for t, x, y in self.points],
                "good_from": round(self.good_from, 3), "good_until": round(self.good_until, 3)}

    @classmethod
    def from_dict(cls, data: dict) -> "Track":
        return cls(start=float(data["start"]), end=float(data["end"]),
                   box=tuple(int(v) for v in data["box"]), label=str(data.get("label", "")),
                   points=[(float(t), float(x), float(y)) for t, x, y in data["points"]],
                   good_from=float(data.get("good_from", data["start"])),
                   good_until=float(data.get("good_until", data["end"])))


def pick_subject(frame, size: tuple[int, int], x: float, y: float) -> tuple[tuple[int, int, int, int], str]:
    """ប្រអប់នៃប្រធានបទនៅចំណុច (x, y) — pixel នៃរូបដើម. ត្រឡប់ (box, label).

    ប្រអប់ YOLOX **តូចជាងគេ** ដែលគ្របចំណុច (កូនរមាសនៅមុខមេ = កូន); គ្មាន -> ប្រអប់ដែលនៅជិតបំផុត
    ក្នុង 10% នៃទទឹង; គ្មានទៀត -> ការ៉េជុំវិញចំណុច ("area" ដូច OpusClip "subject or area").
    """
    from pipeline.subjects import detect_subjects_in_frame

    frame_w, frame_h = size
    found = detect_subjects_in_frame(frame, size)
    inside = [s for s in found if s.x <= x <= s.x + s.w and s.y <= y <= s.y + s.h]
    if inside:
        best = min(inside, key=lambda s: s.area)
        return (best.x, best.y, best.w, best.h), best.label
    near = [s for s in found if abs(s.cx - x) < frame_w * 0.10 and abs(s.cy - y) < frame_h * 0.10]
    if near:
        best = min(near, key=lambda s: (s.cx - x) ** 2 + (s.cy - y) ** 2)
        return (best.x, best.y, best.w, best.h), best.label
    return area_box(size, x, y), "area"


def _read_scene(video_path: Path, start: float, end: float):
    """frame របស់ scene (បង្រួមទៅ TRACK_WIDTH) ជាមួយពេលពិត, ចាប់ពី start ដល់ end."""
    import cv2

    capture = cv2.VideoCapture(str(video_path))
    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    # ជំហាន frame: ១២ ដង/វិនាទី, ឬធំជាងនេះបើ scene វែងពេក (memory)
    step = max(1, round(fps / TRACK_FPS), math.ceil((end - start) * fps / MAX_FRAMES))
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, start) * 1000)
    frames: list = []
    times: list[float] = []
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        moment = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000 - 1 / fps   # POS = frame **បន្ទាប់**
        if moment >= end:
            break
        if moment >= start - 0.5 / fps and index % step == 0:
            scale = TRACK_WIDTH / frame.shape[1]
            frames.append(cv2.resize(frame, (TRACK_WIDTH, round(frame.shape[0] * scale))))
            times.append(moment)
        index += 1
    capture.release()
    return frames, times


def _histogram(frame, box):
    import cv2

    x, y, w, h = (int(v) for v in box)
    patch = frame[max(0, y):y + h, max(0, x):x + w]
    if patch.size == 0:
        return None
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
    return cv2.normalize(hist, hist)


def tracker_name() -> str:
    """"vit" បើ model មាន, មិនដូច្នោះ "mil"."""
    return "vit" if config.TRACKER_MODEL_PATH.is_file() else "mil"


def _make_tracker():
    import cv2

    if tracker_name() == "vit":
        params = cv2.TrackerVit_Params()
        params.net = str(config.TRACKER_MODEL_PATH)
        return cv2.TrackerVit_create(params)
    return cv2.TrackerMIL_create()


def _follow(frames, start_box, reference):
    """តាមប្រអប់តាមលំដាប់ frame; ត្រឡប់ [(index, box, score)] រហូតដល់ចំណុចបាត់ដំបូង."""
    import cv2

    vit = tracker_name() == "vit"
    tracker = _make_tracker()
    tracker.init(frames[0], tuple(int(v) for v in start_box))
    out = [(0, tuple(start_box), 1.0)]
    height, width = frames[0].shape[:2]
    low = 0                        # score ទាបជាប់គ្នាប៉ុន្មាន frame
    for index, frame in enumerate(frames[1:], start=1):
        ok, box = tracker.update(frame)
        x, y, w, h = box
        centre_x, centre_y = x + w / 2, y + h / 2
        if not ok or not (0 <= centre_x <= width and 0 <= centre_y <= height):
            break
        if w > width * BOX_WIDTH_MAX or w * h > width * height * BOX_AREA_MAX:
            break                  # ប្រអប់លាតពេញ frame — លែងតាមប្រធានបទ
        if vit:
            score = float(tracker.getTrackingScore())
            low = low + 1 if score < VIT_SCORE_MIN else 0
            if low >= LOW_STREAK:
                out = out[:len(out) - (LOW_STREAK - 1)] if len(out) > LOW_STREAK else out[:1]
                break              # ដក frame ទាបមុនៗចេញ: ផ្លូវចប់នៅចំណុចល្អចុងក្រោយ
        else:
            hist = _histogram(frame, box)
            score = cv2.compareHist(reference, hist, cv2.HISTCMP_CORREL) if hist is not None else -1.0
            if score < SIMILARITY_MIN:
                break              # ប្រអប់លែងនៅលើប្រធានបទ (ធូលី, វារត់ចេញ)
        out.append((index, tuple(box), float(score)))
    return out


def area_box(size: tuple[int, int], x: float, y: float) -> tuple[int, int, int, int]:
    """ការ៉េ `FALLBACK_BOX` នៃកម្ពស់ ជុំវិញចំណុចចុច (នៅក្នុងរូប) — "area" របស់ OpusClip."""
    frame_w, frame_h = size
    side = int(frame_h * FALLBACK_BOX)
    return (int(min(max(0, x - side / 2), frame_w - side)), int(min(max(0, y - side / 2), frame_h - side)),
            side, side)


def track_subject(video_path: Path, start: float, end: float, at: float,
                  x: float, y: float, size: tuple[int, int], mode: str = "subject") -> Track:
    """ចុចលើ (x, y) pixel នៃរូបដើម នៅពេល `at` ក្នុង scene [start, end) -> ផ្លូវពេញ scene.

    `mode`: "subject" = ប្រអប់ YOLOX ដែលគ្របចំណុច (រមាស, មនុស្ស); "area" = ការ៉េជុំវិញចំណុច
    (វត្ថុក្នុងដៃមនុស្ស: ចុចលើចានបាយ "subject" តាមដៃអ្នកបម្រើ, "area" តាមចាន — វាស់លើ Table For Four).
    """
    frames, times = _read_scene(video_path, start, end)
    if not frames:
        raise ValueError("អាន frame នៃ scene មិនបាន")
    frame_w, frame_h = size
    scale = frames[0].shape[1] / frame_w
    # frame ដែលជិតពេលចុចបំផុត; YOLOX មើលរូប**ពេញទំហំ** (រូប 640 ពង្រីកវិញព្រិលពេក — វាស់: រក "cow"
    # 592x709 ឃើញលើរូបពេញ តែមិនឃើញលើរូបពង្រីក ហើយធ្លាក់ទៅ "area")
    from pipeline.reframe import grab_frame
    click = min(range(len(times)), key=lambda i: abs(times[i] - at))
    if mode == "area":
        box, label = area_box(size, x, y), "area"
    else:
        box, label = pick_subject(grab_frame(video_path, times[click], size), size, x, y)
    small_box = tuple(max(1, round(v * scale)) for v in box)
    reference = _histogram(frames[click], small_box) if tracker_name() == "mil" else None

    forward = _follow(frames[click:], small_box, reference)
    backward = _follow(frames[click::-1], small_box, reference)
    steps = [(click - i, b) for i, b, _ in reversed(backward[1:])] + [(click + i, b) for i, b, _ in forward]
    points = [(times[i], (b[0] + b[2] / 2) / scale, (b[1] + b[3] / 2) / scale) for i, b in steps]
    return Track(start=start, end=end, box=box, label=label, points=points,
                 good_from=points[0][0], good_until=points[-1][0])


def tracks_for_shot(start: float, end: float) -> "Track | None":
    """ផ្លូវដោយដៃដែលជាន់ shot នេះ (`config.SUBJECT_TRACKS`) — ជាន់ច្រើនជាងគេ."""
    best, overlap = None, 0.0
    for track in config.SUBJECT_TRACKS:
        shared = min(end, track.end) - max(start, track.start)
        if shared > overlap:
            best, overlap = track, shared
    return best if best is not None and overlap > 0.2 else None


def shift_track(track: Track, keeps: list[tuple[float, float]]) -> list[Track]:
    """ផ្លូវក្នុងវីដេអូដើម -> ផ្លូវក្នុងច្បាប់ចម្លងដែលបានកាត់ (ចំណុចក្នុងការកាត់ត្រូវដក)."""
    from pipeline.cuts import shift_range, shift_time

    out = []
    for new_start, new_end in shift_range((track.start, track.end), keeps):
        points = []
        for t, cx, cy in track.points:
            moved = shift_time(t, keeps)
            if moved is not None and new_start <= moved <= new_end:
                points.append((moved, cx, cy))
        if points:
            out.append(Track(start=new_start, end=new_end, box=track.box, label=track.label,
                             points=points, good_from=points[0][0], good_until=points[-1][0]))
    return out
