import { useEffect, useState } from 'react'
import type { JobStatus } from './api'
import { estimateRun, type RunEstimate, type RunPlan } from './eta'

/** job "វីដេអូវែង → clips" ដែលចាប់ផ្តើមពី dialog — កាត Projects ថ្មីៗ បង្ហាញវឌ្ឍនភាពរបស់វា. */
export type RunTool = 'clips' | 'subtitles' | 'reframe' | 'editor'

export type Run = {
  name: string // ឈ្មោះ project (= ឈ្មោះ folder ក្នុង output/)
  video: string // path វីដេអូដើម — ផ្គូផ្គងនឹង status.video
  startedAt: number // Date.now() ពេលចុច Start (កាតបណ្តោះអាសន្នប្រើវាជាថ្ងៃបង្កើត)
  tool: RunTool // ឧបករណ៍ដែលចាប់ផ្តើម: toast និងការចុចកាតនាំទៅកន្លែងខុសគ្នា
  plan: RunPlan
}

/** % + ETA ប៉ាន់ស្មាន ដែលប្តូររៀងរាល់វិនាទី ពេល job កំពុងរត់.
 *
 *  ពេលក្នុងជំហាន = តាំងពីបញ្ជីជំហានដែលចប់ប្តូរចុងក្រោយ (វាស់ដោយនាឡិការបស់ UI ±1 s) —
 *  sidecar មិនប្រាប់ថាជំហាននីមួយៗចប់ពេលណាទេ. កត់ត្រាតាមលំនាំ "ព័ត៌មានពី render មុន" របស់ React
 *  (setState ពេល render) មិនមែនក្នុង effect ទេ. */
export function useRunProgress(run: Run | null, status: JobStatus | null): RunEstimate | null {
  const running = Boolean(run && status && status.state === 'running' && status.video === run.video)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const doneKey = running && status ? `${status.id}:${status.progress.done.join(',')}` : ''
  const [seenKey, setSeenKey] = useState('')
  const [stepStartedAt, setStepStartedAt] = useState(0)
  if (doneKey !== seenKey) {
    setSeenKey(doneKey)
    // `now` ដើរតែពេល job រត់ ដូច្នេះនៅការប្តូរដំបូង វានៅជាពេលបើក app ហើយជំហានដំបូងមើលទៅលើស
    // ពេលច្រើននាទី ("ជិតរួច…" នៅវិនាទីទី ១, វាស់លើ Auto Subtitles). ជំហានមិនអាចចាប់ផ្តើមមុនចុច Start ទេ.
    setStepStartedAt(Math.max(now, run?.startedAt ?? 0)) // ជំហានថ្មីចាប់ផ្តើម (ឬ job ថ្មី)
  }

  if (!running || !run || !status) return null
  return estimateRun(run.plan, status.progress, Math.max(0, (now - stepStartedAt) / 1000))
}
