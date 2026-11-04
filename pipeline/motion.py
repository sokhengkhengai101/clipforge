"""Motion (Edit Video): zoom យឺតៗរបស់កាមេរ៉ា, zoom លើពាក្យសំខាន់, និង camera shake.

ទាំងបីជា filter `perspective` **មួយ** ក្នុងមួយ shot: ចតុកោណមួយក្នុងរូប (តូចជាងរូបពេលពង្រីក, រំកិលពេលញ័រ)
ត្រូវទាញឲ្យពេញ frame វិញ. ហេតុអ្វី perspective មិនមែន scale+crop? វាស់លើរូបនឹង 1080x1920 ពង្រីក
100% -> 110% ក្នុង 5 s: scale+crop នៅនឹង 53/82 frame ហើយលោតដល់ 1.88 px (ទំហំប្តូរម្តង ២ px),
perspective នៅនឹងតែ 4/149 និងលោតយ៉ាងច្រើន 0.35 px (coordinate ទសភាគ + interpolation) ហើយលឿនជាង
(2.5 s ធៀប 4.0 s).

Filter ដាក់**ក្រោយ** layout និង**មុន** caption: អក្សរមិន zoom និងមិនញ័រ.
"""

import math
import re
import wave
from dataclasses import dataclass, field
from pathlib import Path

import config

KEYWORD_PEAK_SEC = 0.12      # zoom ឡើងដល់កំពូល 0.12 s ក្រោយពាក្យចាប់ផ្តើម
KEYWORD_WIDTH_SEC = 0.18     # ទទឹងរបស់ "ដុំ" zoom (gaussian) — ចូល និងចេញក្នុង ~0.5 s
KEYWORD_GAP_SEC = 3.0        # យ៉ាងតិចប៉ុណ្ណេះរវាង zoom ពីរ (រាល់ cue មានពាក្យវែង ១ — ញឹកពេក)
SHAKE_AMOUNT = 0.006         # ញ័រ 0.6% នៃទទឹង/កម្ពស់ (6 px នៃ 1080)
LOUD_WINDOW_SEC = 0.25       # វាស់សំឡេងក្នុងប្រអប់ 0.25 s
LOUD_PERCENTILE = 90         # ខ្លាំងជាង 90% នៃប្រអប់ = "សំឡេងខ្លាំង"
SHAKE_RAMP_SEC = 0.15        # ញ័រចូល/ចេញបន្តិចម្តងៗ — បើបើកភ្លាម រូបលោត 6 px ក្នុង frame មួយ
ZOOM_MAX = 1.25              # zoom សរុប (កាមេរ៉ា x ពាក្យ x ញ័រ) មិនលើសនេះ


@dataclass
class MotionCues:
    """ពេលដែល effect កើតក្នុង clip មួយ (វិនាទី ធៀបនឹងដើម clip)."""

    keywords: list[float] = field(default_factory=list)
    loud: list[tuple[float, float]] = field(default_factory=list)


def enabled() -> bool:
    return (config.MOTION_ZOOM != "off" or config.MOTION_KEYWORDS > 0
            or config.MOTION_SHAKE != "off")


def keyword_moments(words, clip_start: float) -> list[float]:
    """ពេលពាក្យសំខាន់ (ពាក្យដែល `captions.pick_keywords` ជ្រើស) ធៀបនឹងដើម clip, ឃ្លាតគ្នា ≥ 3 s."""
    from pipeline.captions import pick_keywords, wrap_into_cues

    moments: list[float] = []
    for cue in wrap_into_cues(words, clip_start):
        keywords = pick_keywords(cue)
        for line in cue.lines:
            for word in line:
                if re.sub(r"[^\w']", "", word.word.strip().lower()) in keywords:
                    at = max(0.0, word.start - clip_start)
                    if not moments or at - moments[-1] >= KEYWORD_GAP_SEC:
                        moments.append(round(at, 3))
                    break
    return moments


def loud_ranges(wav_path: Path, start: float, end: float) -> list[tuple[float, float]]:
    """ចន្លោះដែលសំឡេងខ្លាំង (ធៀបនឹងដើម clip) ពី `audio.wav` — សម្រាប់ shake "ពេលសំឡេងខ្លាំង"."""
    import numpy as np

    try:
        with wave.open(str(wav_path), "rb") as reader:
            rate = reader.getframerate()
            reader.setpos(int(max(0.0, start) * rate))
            samples = np.frombuffer(reader.readframes(int((end - start) * rate)), dtype=np.int16)
    except (OSError, wave.Error):
        return []
    size = int(rate * LOUD_WINDOW_SEC)
    if samples.size < size * 2:
        return []
    boxes = samples[: samples.size // size * size].reshape(-1, size).astype(np.float32)
    rms = np.sqrt((boxes ** 2).mean(axis=1))
    limit = np.percentile(rms, LOUD_PERCENTILE)
    out: list[tuple[float, float]] = []
    for index in np.nonzero(rms >= max(limit, 1.0))[0]:
        a, b = index * LOUD_WINDOW_SEC, (index + 1) * LOUD_WINDOW_SEC
        if out and a - out[-1][1] < 0.5:               # បញ្ចូលចន្លោះជិតគ្នា
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return [(round(float(a), 3), round(float(b), 3)) for a, b in out]


def _num(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".") or "0"


def zoom_expression(shot_start: float, shot_end: float, cues: MotionCues, fps: float) -> str | None:
    """កន្សោម z(frame) ក្នុង shot មួយ (1 = គ្មាន zoom). `None` = គ្មាន effect ក្នុង shot នេះ.

    T = ពេលក្នុង shot (`on/fps`, perspective មិនមាន `t`), X = ពេលក្នុង clip.
    """
    duration = max(0.1, shot_end - shot_start)
    T = f"(on/{_num(fps)})"
    X = f"({_num(shot_start)}+{T})"
    parts: list[str] = []
    amount = config.MOTION_ZOOM_AMOUNT / 100
    if config.MOTION_ZOOM == "in":
        parts.append(f"(1+{_num(amount)}*{T}/{_num(duration)})")
    elif config.MOTION_ZOOM == "out":
        parts.append(f"(1+{_num(amount)}*(1-{T}/{_num(duration)}))")
    strength = config.MOTION_KEYWORDS / 100
    if strength > 0:
        near = [k for k in cues.keywords if shot_start - 0.6 <= k <= shot_end + 0.6]
        if near:
            bumps = "+".join(f"exp(-pow(({X}-{_num(k + KEYWORD_PEAK_SEC)})/{_num(KEYWORD_WIDTH_SEC)},2))"
                             for k in near)
            parts.append(f"(1+{_num(strength)}*min(1,{bumps}))")
    if config.MOTION_SHAKE != "off":
        parts.append(_num(1 + 2.5 * SHAKE_AMOUNT))     # ពង្រីកជានិច្ច ដើម្បីកុំឲ្យគែមលេចពេលញ័រ
    if not parts:
        return None
    return f"min({_num(ZOOM_MAX)},{'*'.join(parts)})"


def shake_gate(shot_start: float, shot_end: float, cues: MotionCues, fps: float) -> str | None:
    """1 ពេលត្រូវញ័រ, 0 ពេលមិនញ័រ (តាម `MOTION_SHAKE`)."""
    if config.MOTION_SHAKE == "all":
        return "1"
    if config.MOTION_SHAKE != "loud":
        return None
    X = f"({_num(shot_start)}+on/{_num(fps)})"
    near = [(a, b) for a, b in cues.loud if a < shot_end and b > shot_start]
    if not near:
        return None
    # រាងចតុកោណព្នាយ (trapezoid): 0 -> 1 ក្នុង 0.15 s ដើមចន្លោះ, 1 -> 0 ក្នុង 0.15 s ចុងចន្លោះ
    ramp = _num(SHAKE_RAMP_SEC)
    return "min(1," + "+".join(
        f"min(1,max(0,({X}-{_num(a)})/{ramp}))*min(1,max(0,({_num(b)}-{X})/{ramp}))" for a, b in near) + ")"


def motion_filter(shot_start: float, shot_end: float, cues: MotionCues | None, fps: float,
                  width: int, height: int) -> str:
    """filter `perspective` សម្រាប់ shot មួយ (ពេលធៀបនឹងដើម clip), ឬ "" បើគ្មាន effect."""
    if not enabled():
        return ""
    cues = cues or MotionCues()
    z = zoom_expression(shot_start, shot_end, cues, fps)
    if z is None:
        return ""
    gate = shake_gate(shot_start, shot_end, cues, fps)
    X = f"({_num(shot_start)}+on/{_num(fps)})"
    if gate:
        # ប្រេកង់ពីរដែលមិនមែនពហុគុណ = ញ័រដូចដៃ មិនមែនយោលទៀងទាត់
        dx = f"({gate})*{_num(SHAKE_AMOUNT * width)}*(0.6*sin(2*PI*1.7*{X})+0.4*sin(2*PI*4.3*{X}))"
        dy = f"({gate})*{_num(SHAKE_AMOUNT * height)}*(0.6*sin(2*PI*1.3*{X}+1)+0.4*sin(2*PI*3.7*{X}))"
    else:
        dx = dy = "0"
    a = f"(W*(1-1/{z})/2+{dx})"          # ចំណុចឆ្វេងនៃចតុកោណប្រភព
    b = f"(H*(1-1/{z})/2+{dy})"
    a2 = f"(W-W*(1-1/{z})/2+{dx})"       # ចំណុចស្តាំ
    b2 = f"(H-H*(1-1/{z})/2+{dy})"
    corners = {"x0": a, "y0": b, "x1": a2, "y1": b, "x2": a, "y2": b2, "x3": a2, "y3": b2}
    return ("perspective=" + ":".join(f"{key}='{value}'" for key, value in corners.items())
            + ":interpolation=cubic:eval=frame")
