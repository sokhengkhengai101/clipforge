import type { StepState } from '../progress'
import { DoneCheck } from '../kit/icons'

/** ជំហានមួយក្នុងបញ្ជីវឌ្ឍនភាព (Processing.html, ReframeProcessing.html): spinner ពេលកំពុងធ្វើ,
 *  រង្វង់ទទេពេលរង់ចាំ, ធីកបៃតងពេលរួច, ធីកប្រផេះពេល cache ឬរំលង. */
export function StepRow({ state, title, detail }: { state: StepState; title: string; detail: string }) {
  const pending = state === 'pending'
  return (
    <li className={`flex gap-3.5 rounded-button px-2 py-3 ${state === 'active' ? 'bg-[#1B202A]' : ''}`}>
      {state === 'active' ? (
        <span className="size-7 shrink-0 animate-spin rounded-full border-[3px] border-raised-3 border-t-gold" />
      ) : pending ? (
        <span className="size-7 shrink-0 rounded-full border-2 border-raised-3" />
      ) : (
        <span
          className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full ${
            state === 'done' ? 'bg-ok-bg text-ok' : 'bg-raised text-text-3'
          }`}
        >
          <DoneCheck />
        </span>
      )}
      <span>
        <span className={`block text-[15px] font-semibold ${pending ? 'text-text-3' : ''}`}>{title}</span>
        <span
          className={`block text-[13px] ${state === 'active' ? 'text-text-2' : pending ? 'text-text-4' : 'text-text-3'}`}
        >
          {detail}
        </span>
      </span>
    </li>
  )
}
