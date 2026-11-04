import { useEffect, useRef, useState } from 'react'
import type { JobStatus } from '../api'
import type { StepState } from '../progress'
import { Button, Progress } from '../kit/controls'
import { InfoIcon } from '../kit/icons'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import type { ReframeSettings } from './ReframeSetup'
import { StepRow } from './StepRow'
import { clock, khmerNumber } from './khmer'

const HEADLINE: Record<JobStatus['state'], string> = {
  running: 'កំពុង Reframe',
  done: 'Reframe រួចរាល់ហើយ!',
  failed: 'Reframe មិនបាន',
  cancelled: 'បានបោះបង់',
}

/** Screen "កំពុង Reframe" (design/screens/ReframeProcessing.html) ភ្ជាប់ទៅ job `--full` ពិត.
 *
 *  ជំហានគឺអ្វីដែល pipeline ធ្វើពិត ហើយនីមួយៗមាន file សម្គាល់: audio.wav, transcript.json,
 *  clip_01_layout.json (វិភាគ shot និងមុខរួច), .ass, រួច render ចប់ពេល process ចប់.
 *  design មាន "រកអ្នកកំពុងនិយាយ · ផ្គូផ្គងសំឡេងជាមួយបបូរមាត់" — នោះជា diarization (Phase 2);
 *  ឥឡូវ planner ផ្ដោតលើមុខធំបំផុត ហើយ screen សរសេរប្រាប់. គ្មាន % ឬ "នៅសល់ ២ នាទី" ទេ
 *  (ដូច Processing) ព្រោះគ្មានវឌ្ឍនភាពក្នុងជំហាននីមួយៗ; ស៊ុមមុខផ្ទាល់ក៏គ្មានដែរ. */
export function ReframeProcessingScreen({
  status,
  log,
  error,
  videoName,
  settings,
  onCancel,
  onResult,
  onBack,
  onHome,
}: {
  status: JobStatus
  log: string[]
  error: string
  videoName: string
  settings: ReframeSettings
  onCancel: () => void
  onResult: () => void
  onBack: () => void
  onHome: () => void
}) {
  const running = status.state === 'running'
  const progress = status.progress
  const steps: { id: string; title: string; done: boolean; active: string; detail: string }[] = [
    { id: 'audio', title: 'ទាញសំឡេងចេញ', done: progress.done.includes('audio'), active: 'FFmpeg · WAV 16 kHz', detail: '' },
    {
      id: 'transcribe',
      title: 'Transcribe សំឡេង',
      done: progress.done.includes('transcribe'),
      active: 'Whisper — សម្រាប់ subtitles និង .srt/.vtt',
      detail: '',
    },
    {
      id: 'plan',
      title: 'រកការប្ដូរ shot និងមុខមនុស្ស',
      done: progress.planned ?? false,
      active: 'scene detection · មុខ · YOLOX (មនុស្ស/សត្វ) · ជ្រើស layout តាម shot',
      detail: 'layout ត្រូវបានជ្រើសសម្រាប់ shot នីមួយៗ',
    },
    {
      id: 'captions',
      title: settings.captions ? 'បង្កើត Subtitles' : 'សរសេរ .srt / .vtt',
      done: progress.done.includes('captions'),
      active: settings.captions ? 'subtitles សម្រាប់វីដេអូទាំងមូល...' : 'គ្មាន caption ដុត',
      detail: '',
    },
    { id: 'render', title: `Render ${settings.aspect}`, done: progress.done.includes('render'), active: 'FFmpeg កំពុង render វីដេអូទាំងមូល...', detail: '' },
  ]
  const firstOpen = steps.findIndex((step) => !step.done)
  const stateOf = (index: number): StepState => {
    const step = steps[index]
    if (step.done) return progress.cached.includes(step.id) ? 'cached' : 'done'
    return running && index === firstOpen ? 'active' : 'pending'
  }
  const detailOf = (index: number): string => {
    const state = stateOf(index)
    const step = steps[index]
    if (state === 'active') return step.active
    if (state === 'pending') return 'កំពុងរង់ចាំ'
    if (state === 'cached') return 'រួចរាល់ពីមុន (cache)'
    return step.detail || 'រួចរាល់'
  }
  const finished = steps.filter((step) => step.done).length

  // រយៈពេលកន្លងទៅ — រាប់នៅទីនេះ ព្រោះ sidecar ផ្ញើ status តែពេលអ្វីប្តូរ (App ផ្តល់ key = job id)
  const [startedAt] = useState(() => Date.now() - status.seconds * 1000)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const elapsed = running ? (now - startedAt) / 1000 : status.seconds

  const logBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight })
  }, [log.length])

  const problem = error || status.error
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={settings.tool ?? 'AI Reframe'} onHome={onHome}>
        <AccountButton />
      </TopBar>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-10 pb-8 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="type-page">{HEADLINE[status.state]}</h1>
              <p className="mt-1 type-body break-all text-text-3">
                {[videoName, settings.aspect, settings.layouts.join(' + ') || 'center', settings.captions ? 'subtitles' : 'គ្មាន subtitles'].join(' · ')}
              </p>
            </div>
            {running ? (
              <Button onClick={onCancel}>បោះបង់</Button>
            ) : status.state === 'done' ? (
              <Button variant="primary" onClick={onResult}>
                មើលលទ្ធផល
              </Button>
            ) : (
              <Button onClick={onBack}>ត្រឡប់ក្រោយ</Button>
            )}
          </div>

          <div>
            <div className="mb-2 flex justify-between type-body">
              <span className="font-semibold">
                ជំហាន {khmerNumber(finished)} / {khmerNumber(steps.length)} រួចរាល់
              </span>
              <span className="text-text-3">រយៈពេល {clock(elapsed)}</span>
            </div>
            <Progress value={(finished / steps.length) * 100} label="ជំហានដែលរួចរាល់" />
          </div>

          <div className="flex flex-wrap items-stretch gap-6">
            <ol className="m-0 flex min-w-0 flex-[1_1_340px] list-none flex-col gap-1 rounded-card border border-line bg-[#141821] p-5">
              {steps.map((step, index) => (
                <StepRow key={step.id} state={stateOf(index)} title={step.title} detail={detailOf(index)} />
              ))}
              <li className="mt-1 rounded-button bg-field px-3 py-2.5 type-hint text-text-4">
                រកអ្នកកំពុងនិយាយ (ផ្គូផ្គងសំឡេងជាមួយបបូរមាត់) = PHASE 2 · ឥឡូវ AI ផ្ដោតលើមុខធំបំផុតក្នុង shot
              </li>
            </ol>
            <section aria-labelledby="log-title" className="flex min-w-0 flex-[1.2_1_380px] flex-col gap-3 rounded-card border border-line bg-card p-5">
              <h2 id="log-title" className="text-[15px] font-bold">
                Log របស់ pipeline
              </h2>
              <div ref={logBox} className="max-h-[360px] min-h-[200px] overflow-y-auto rounded-button bg-[#0e1116] px-3.5 py-3">
                {log.length === 0 ? (
                  <p className="type-hint text-text-4">កំពុងរង់ចាំ...</p>
                ) : (
                  log.slice(-120).map((line, index) => (
                    <p key={index} className="m-0 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-text-3">
                      {line}
                    </p>
                  ))
                )}
              </div>
            </section>
          </div>

          {problem && (
            <p className="rounded-[12px] border border-line bg-card px-4.5 py-3.5 type-body whitespace-pre-wrap text-danger">{problem}</p>
          )}

          <p className="flex items-center gap-2.5 rounded-[12px] border border-line bg-[#161B24] px-4.5 py-3.5 type-body text-text-2">
            <InfoIcon />
            {running
              ? 'កុំបិទ app ពេលកំពុងដំណើរការ — ការបិទវាបញ្ឈប់ការងារ។ វីដេអូវែង: interview ៤៧ នាទី ≈ ១៥½ នាទី។'
              : 'ក្រោយរួច អ្នកមើល layout ដែល AI ជ្រើសសម្រាប់ shot នីមួយៗបាន (ការកែតាម shot មិនទាន់មាន)។'}
          </p>
        </div>
      </main>
    </div>
  )
}
