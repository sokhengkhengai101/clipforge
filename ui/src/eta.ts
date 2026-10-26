import { STEPS, type Progress } from './api'

/** ការប៉ាន់ស្មាន % និង ETA របស់ job "វីដេអូវែង → clips" (កាត Projects ថ្មីៗ).
 *
 *  Pipeline មិនដឹង % ពិតទេ — វាដឹងតែជំហានណាចប់. ដូច្នេះយើងប៉ាន់រយៈពេលជំហាននីមួយៗពីល្បឿនដែល
 *  **វាស់ពិតលើម៉ាស៊ីននេះ** (CLAUDE.md) គុណនឹងប្រវែងវីដេអូ, ហើយ UI សរសេរថា "ប៉ាន់ស្មាន".
 *  វាស់: video 35:25 -> audio 3 s, transcribe 7:18 (GPU medium), highlights 19:30 (7b + rubric),
 *  boundaries 12 s, captions 19 s, render 37 s សម្រាប់ ៥ clips. */
export type RunPlan = {
  seconds: number | null // ប្រវែងវីដេអូ (/probe); null = មិនទាន់ដឹង
  device: string // 'cuda' | 'cpu'
  whisperModel: string // small | medium | large-v3
  llm: string // qwen2.5:7b-instruct ...
  clips: number // --max-clips
  full?: boolean // --full (Auto Subtitles / AI Reframe): វីដេអូទាំងមូលជា file មួយ
}

/** វិនាទីដែលជំហាននីមួយៗប៉ាន់ថាត្រូវការ (មិនរាប់ cache). */
export function stepSeconds(plan: RunPlan): Record<string, number> {
  const minutes = (plan.seconds ?? 600) / 60 // មិនទាន់ដឹងប្រវែង -> សន្មត ១០ នាទី
  const gpu = plan.device === 'cuda'
  // transcribe: GPU medium 12.4 s ក្នុងមួយនាទីវីដេអូ (7:18 / 35:25); small លឿនជាង ~2 ដង;
  // CPU small 1.4x realtime = 43 s/នាទី; CPU medium មិនបានវាស់ — ប៉ាន់ ~2.3 ដងនៃ small
  const whisperSmall = plan.whisperModel === 'small' || plan.whisperModel === 'base' || plan.whisperModel === 'tiny'
  const transcribePerMinute = gpu ? (whisperSmall ? 6 : 12.4) : whisperSmall ? 43 : 100
  // highlights: 7b + rubric 33 s/នាទី (19:30 / 35:25); 3b ~7 s; 14b មិនសម VRAM នេះ — ប៉ាន់ 2x នៃ 7b
  const highlightsPerMinute = plan.llm.includes('3b') ? 7 : plan.llm.includes('14b') ? 66 : 33
  // ថេរ (មិនអាស្រ័យប្រវែង): ផ្ទុក model Whisper / Ollama និងវិភាគ shot (មុខ + YOLOX) មុន render —
  // វាស់លើ Rhino 0:55 ដំបូង: transcribe ~24 s, highlights ~85 s, boundaries→render ~67 s ក្នុង ១ clip;
  // ក្រោយបន្ថែម វីដេអូ 35:25 នៅតែប៉ាន់ ~29 នាទី (វាស់ 28)
  if (plan.full) {
    // វីដេអូទាំងមូល: highlights/boundaries = skipped (sidecar រាយការណ៍); render រួមការវិភាគ shot
    // វាស់: interview 47 នាទី = plan 4.5 នាទី + render 10:17 (~19 s/នាទី វីដេអូ); Rhino 0:55 = 13-37 s
    return {
      audio: 3 + 0.1 * minutes,
      transcribe: 15 + transcribePerMinute * minutes,
      highlights: 0,
      boundaries: 0,
      captions: 4 + 0.2 * minutes,
      render: 15 + 19 * minutes,
    }
  }
  return {
    audio: 3 + 0.1 * minutes,
    transcribe: 15 + transcribePerMinute * minutes,
    highlights: 60 + highlightsPerMinute * minutes,
    boundaries: 12,
    captions: 4 * plan.clips,
    render: 30 + 8 * plan.clips,
  }
}

export type RunEstimate = {
  percent: number // 0-99 (100 តែពេល job ចប់ពិត)
  remaining: number | null // វិនាទីនៅសល់; null = លើសការប៉ាន់ ("ជិតរួច...")
  step: string // ជំហានដែលកំពុងរត់
  measured: boolean // ជំហាននេះមានវឌ្ឍនភាពពិតពី pipeline (មិនមែនប៉ាន់ពីល្បឿនចាស់ទេ)
}

/** % = ពេលប៉ាន់នៃជំហានដែលចប់ + ពេលក្នុងជំហានបច្ចុប្បន្ន (ឈប់នៅ 95% របស់វា) ÷ ពេលប៉ាន់សរុប.
 *  ជំហាន cache និង skip = 0 វិនាទី. `inStep` = វិនាទីតាំងពីជំហានមុនចប់.
 *
 *  បើ pipeline ប្រាប់ចំណែកពិត `f` នៃជំហាន (`progress.fraction`, ពីបន្ទាត់ "progress ..."):
 *  % ប្រើ f ផ្ទាល់ ហើយពេលនៅសល់នៃជំហាននេះ = ល្បឿនពិត: inStep × (1 − f) / f — វីដេអូ 47 នាទី
 *  ធ្លាប់ឈប់នៅ 24% ពេល transcribe យឺតជាងការប៉ាន់ពីរដង. ជំហានបន្ទាប់នៅតែប៉ាន់. */
export function estimateRun(plan: RunPlan, progress: Progress, inStep: number): RunEstimate {
  const each = stepSeconds(plan)
  const free = new Set([...progress.cached, ...(progress.skipped ?? [])])
  const cost = (step: string) => (free.has(step) ? 0 : each[step] ?? 0)
  const total = STEPS.reduce((sum, step) => sum + cost(step), 0)
  const done = new Set(progress.done)
  // ជំហានដែលគ្មានពេល (cache, skip, ឬ highlights លើ job វីដេអូទាំងមូល) មិនមែនជា "ជំហានបច្ចុប្បន្ន" ទេ —
  // បើមិនដូច្នោះ វាលើសការប៉ាន់ភ្លាម ហើយកាតសរសេរ "ជិតរួច…" តាំងពីវិនាទីទី ១ (វាស់លើ Auto Subtitles)
  const current = STEPS.find((step) => !done.has(step) && cost(step) > 0) ?? 'render'
  const finished = STEPS.filter((step) => done.has(step)).reduce((sum, step) => sum + cost(step), 0)
  const currentCost = cost(current)
  const after = total - finished - currentCost // ជំហានដែលនៅខាងមុខ (ប៉ាន់)
  const f = progress.fraction?.[current]
  if (f !== undefined && f > 0) {
    // ល្បឿនពិតត្រូវការពេលបន្តិចដើម្បីស្ថិតស្ថេរ (≥ 3% និង ≥ 10 s); មុននោះប្រើការប៉ាន់
    const steady = f >= 0.03 && inStep >= 10
    // ប្រវែងជំហាននេះ: ពីល្បឿនពិត (inStep ÷ f) — ក្នុង % ផងដែរ មិនមែនតែ ETA ទេ, បើមិនដូច្នោះ
    // % ធ្លាក់ពី 24 មក 7 ភ្លាមពេល f មកដល់ (transcribe ពិតវែងជាងការប៉ាន់ច្រើនដង)
    const stepTotal = steady ? inStep / f : currentCost
    const spentNow = finished + f * stepTotal
    const totalNow = finished + stepTotal + after
    const percent = totalNow > 0 ? Math.min(99, Math.floor((spentNow / totalNow) * 100)) : 0
    return { percent, remaining: Math.max(0, stepTotal * (1 - f) + after), step: current, measured: true }
  }
  const spent = finished + Math.min(inStep, currentCost * 0.95)
  const percent = total > 0 ? Math.min(99, Math.floor((spent / total) * 100)) : 0
  const overdue = inStep > currentCost
  const remaining = overdue ? null : Math.max(0, total - finished - inStep)
  return { percent, remaining, step: current, measured: false }
}

/** 540 -> "~៩ នាទី", 40 -> "<១ នាទី" (ជាលេខខ្មែរ). */
export function etaLabel(seconds: number | null, khmer: (n: number) => string): string {
  if (seconds === null) return 'ជិតរួច…'
  if (seconds < 60) return '<១ នាទី'
  return `~${khmer(Math.round(seconds / 60))} នាទី`
}
