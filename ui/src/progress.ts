import type { Progress } from './api'

/** ស្ថានភាពរបស់ជំហាននីមួយៗ ដែលគណនាពី progress របស់ job (server/jobs.py).
 *  នៅដាច់ពី component ព្រោះវាជា logic: screen Processing ចាស់ និងថ្មីប្រើវាដូចគ្នា. */
export type StepState = 'done' | 'cached' | 'active' | 'pending'

export function stepStates(progress: Progress, steps: readonly string[]): StepState[] {
  const done = new Set(progress.done)
  const cached = new Set(progress.cached)
  // ជំហានដំបូងដែលមិនទាន់ចប់ = ជំហានកំពុងរត់
  const runningAt = steps.findIndex((step) => !done.has(step))
  return steps.map((step, index) => {
    if (index === runningAt) return 'active'
    if (cached.has(step)) return 'cached'
    return done.has(step) ? 'done' : 'pending'
  })
}
