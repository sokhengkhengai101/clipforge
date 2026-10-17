import type { Progress } from '../api'
import check from '../assets/figma/check.svg'
import active from '../assets/figma/active.svg'

/** ជំហានពិតរបស់ pipeline (pipeline/ ក្នុង repo) + អ្វីដែលវាប្រើ.
 *  Design បង្ហាញ ៨ ជំហាន (មាន VAD និង diarization ដែលជារបស់ Phase 2) —
 *  នេះជា ៦ ជំហានដែល **មានពិត** ថ្ងៃនេះ. */
export const STEP_DETAIL: Record<string, string> = {
  audio: 'FFmpeg · WAV 16 kHz mono',
  transcribe: 'faster-whisper · word timestamps',
  highlights: 'Local LLM · chunk ~5 min',
  boundaries: 'Snap start / end to full sentences',
  captions: 'ASS + SRT/VTT · ≤ 32 chars a line',
  render: 'FFmpeg · 1080×1920 · burn captions',
}

const STEP_TITLE: Record<string, string> = {
  audio: 'Extract audio',
  transcribe: 'Transcribe',
  highlights: 'Find highlights',
  boundaries: 'Snap clip boundaries',
  captions: 'Build captions',
  render: 'Render clips',
}

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

export function StepItem({ step, state }: { step: string; state: StepState }) {
  const pending = state === 'pending'
  return (
    <div className="flex h-12 w-full items-center gap-3">
      <Indicator state={state} />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-body-strong ${
            pending ? 'text-text-secondary' : 'text-text-primary'
          }`}
        >
          {STEP_TITLE[step] ?? step}
          {state === 'cached' && (
            <span className="ml-2 text-caption text-text-secondary">cached</span>
          )}
        </p>
        <p className="truncate text-caption text-text-secondary">{STEP_DETAIL[step]}</p>
      </div>
    </div>
  )
}

function Indicator({ state }: { state: StepState }) {
  if (state === 'pending')
    return <div className="size-7 shrink-0 rounded-full border-[1.5px] border-border-strong" />
  if (state === 'active')
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent">
        <img src={active} alt="" width={16} height={16} />
      </div>
    )
  return (
    <div
      className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
        state === 'cached' ? 'bg-bg-hover' : 'bg-success'
      }`}
    >
      <img src={check} alt="" width={16} height={16} />
    </div>
  )
}
