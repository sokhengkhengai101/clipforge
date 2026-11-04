import type { Motion, MotionCues } from './api'

/** Motion ក្នុង preview — រូបមន្តដូច `pipeline/motion.py` (zoom កាមេរ៉ា x zoom ពាក្យ x overscan,
 *  ញ័រពីរ sine, ដែន 1.25) ដូច្នេះអ្វីដែលឃើញក្នុង editor ត្រូវនឹង render.
 *
 *  ឧ. zoom "in" 8%, scene 10-15 s, ពេល 12.5 s -> z = 1 + 0.08 x 2.5/5 = 1.04. */
const KEYWORD_PEAK = 0.12
const KEYWORD_WIDTH = 0.18
const SHAKE = 0.006
const RAMP = 0.15
const ZOOM_MAX = 1.25

export type MotionFrame = { z: number; dx: number; dy: number } // dx, dy = ភាគនៃទទឹង/កម្ពស់

export function motionAt(time: number, motion: Motion, scenes: [number, number][], cues: MotionCues | null): MotionFrame {
  let z = 1
  const scene = scenes.find(([start, end]) => time >= start && time < end)
  if (scene && motion.zoom !== 'off') {
    const k = (time - scene[0]) / Math.max(0.1, scene[1] - scene[0])
    z *= 1 + (motion.zoom_amount / 100) * (motion.zoom === 'in' ? k : 1 - k)
  }
  if (motion.keywords > 0 && cues) {
    const bump = cues.keywords.reduce((sum, at) => sum + Math.exp(-(((time - at - KEYWORD_PEAK) / KEYWORD_WIDTH) ** 2)), 0)
    z *= 1 + (motion.keywords / 100) * Math.min(1, bump)
  }
  let gate = 0
  if (motion.shake !== 'off') {
    z *= 1 + 2.5 * SHAKE
    gate =
      motion.shake === 'all'
        ? 1
        : Math.min(
            1,
            (cues?.loud ?? []).reduce(
              (sum, [a, b]) => sum + Math.min(1, Math.max(0, (time - a) / RAMP)) * Math.min(1, Math.max(0, (b - time) / RAMP)),
              0,
            ),
          )
  }
  const dx = gate * SHAKE * (0.6 * Math.sin(2 * Math.PI * 1.7 * time) + 0.4 * Math.sin(2 * Math.PI * 4.3 * time))
  const dy = gate * SHAKE * (0.6 * Math.sin(2 * Math.PI * 1.3 * time + 1) + 0.4 * Math.sin(2 * Math.PI * 3.7 * time))
  return { z: Math.min(ZOOM_MAX, z), dx, dy }
}

/** CSS transform: render ផ្លាស់ចតុកោណប្រភព **ទៅ** (dx, dy) ដូច្នេះរូបលើអេក្រង់រំកិល**ផ្ទុយ**. */
export function motionTransform({ z, dx, dy }: MotionFrame): string {
  return `scale(${z.toFixed(4)}) translate(${(-dx * 100).toFixed(3)}%, ${(-dy * 100).toFixed(3)}%)`
}
