import type { ReframeSettings } from './ReframeSetup'

export type Aspect = ReframeSettings['aspect']
export const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9, '4:5': 4 / 5 }
export const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9', '4:5']

/** aspect ដែលជិតនឹងវីដេអូបំផុត (1280x720 -> 16:9) = "ដូចវីដេអូ". */
export function nearestAspect(ratio: number): Aspect {
  return ASPECTS.reduce((best, item) => (Math.abs(RATIO[item] - ratio) < Math.abs(RATIO[best] - ratio) ? item : best))
}
