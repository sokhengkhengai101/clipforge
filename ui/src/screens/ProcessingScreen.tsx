import { useEffect, useRef, useState } from 'react'
import { api, STEPS, type JobStatus, type TranscriptPreview } from '../api'
import { stepStates, type StepState } from '../progress'
import { Button, Progress, Segmented } from '../kit/controls'
import { InfoIcon } from '../kit/icons'
import { TopBar } from '../kit/TopBar'
import { AccountButton } from './AccountButton'
import { StepRow } from './StepRow'
import { clock, khmerNumber } from './khmer'

/** ជំហានពិតទាំង ៦ របស់ pipeline (server/jobs.py STEPS). design គូរ ៤ ("Transcribe",
 *  "AI ជ្រើស Clips", "Subtitles ខ្មែរ", "Render") — នេះជាអ្វីដែលរត់ពិត ហើយ subtitles
 *  ជាភាសាដូចសំឡេង (ខ្មែរ = Phase 2). `active` = អ្វីដែលវាកំពុងធ្វើ. */
const STEP_TEXT: Record<string, { title: string; active: string }> = {
  audio: { title: 'ទាញសំឡេងចេញ', active: 'FFmpeg · WAV 16 kHz' },
  transcribe: { title: 'Transcribe សំឡេង', active: 'Whisper កំពុងស្តាប់ និងសរសេរពាក្យ...' },
  highlights: { title: 'AI ជ្រើស Clips', active: 'កំពុងរក hook និងចម្លើយល្អៗ...' },
  boundaries: { title: 'កាត់ឲ្យចប់ប្រយោគ', active: 'កែចំណុចចាប់ផ្តើម និងបញ្ចប់ clip...' },
  captions: { title: 'បង្កើត Subtitles', active: 'បំបែក subtitles ជាបន្ទាត់ខ្លីៗ...' },
  render: { title: 'Render clips', active: 'FFmpeg កំពុង render...' },
}

const HEADLINE: Record<JobStatus['state'], string> = {
  queued: 'កំពុងរង់ចាំក្នុងជួរ',
  running: 'កំពុងបង្កើត Clips',
  done: 'Clips រួចរាល់ហើយ!',
  failed: 'បង្កើត Clips មិនបាន',
  cancelled: 'បានបោះបង់',
}

/** Screen "Processing" (design/screens/Processing.html), ភ្ជាប់ទៅ job ពិតតាម WebSocket.
 *
 *  design បង្ហាញ "[៦២]%" និង "នៅសល់ [៣] នាទី". ជំហានមានរយៈពេលខុសគ្នាខ្លាំង (វាស់: transcribe
 *  ៨ នាទី, highlights ៨ នាទីកន្លះ, boundaries/captions < ១ វិ) ហើយមិនមានវឌ្ឍនភាពក្នុងជំហាននីមួយៗ
 *  — ភាគរយ ឬ ETA នឹងជាការទាយ. ដូច្នេះវាបង្ហាញ "ជំហាន X / ៦" និងរយៈពេលកន្លងទៅពិត.
 *  design សរសេរថា "អ្នកអាចបិទ window នេះ" — មិនពិតទេ: បិទ app = សម្លាប់ sidecar និង job. */
export function ProcessingScreen({
  status,
  log,
  error,
  projectName,
  videoName,
  runLabel,
  device,
  onCancel,
  onReview,
  onBack,
  onHome,
}: {
  status: JobStatus
  log: string[]
  error: string
  projectName: string
  videoName: string
  runLabel: string // "៥ clips · Podcast Clips" — អ្វីដែលបានចាប់ផ្តើម
  device: string // cuda / cpu ពី /health (ប្រើមុន transcript ប្រាប់អ្វីដែល Whisper ប្រើពិត)
  onCancel: () => void
  onReview: () => void
  onBack: () => void
  onHome: () => void
}) {
  const running = status.state === 'running'
  const states = stepStates(status.progress, STEPS)
  const finished = status.progress.done.length

  // រយៈពេល: sidecar ផ្ញើ status តែពេលអ្វីប្តូរ — អំឡុង transcribe អាចស្ងាត់ច្រើននាទី.
  // ដូច្នេះរាប់នៅទីនេះរៀងរាល់វិនាទី ពីពេលចាប់ផ្តើម (App ផ្តល់ `key` = job id).
  const [startedAt] = useState(() => Date.now() - status.seconds * 1000)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const elapsed = running ? (now - startedAt) / 1000 : status.seconds

  // transcript.json មានក្រោយ transcribe; highlights.json ក្រោយ highlights — ទាញតែពេលនោះ
  const transcribed = status.progress.done.includes('transcribe')
  const picked = status.progress.done.includes('highlights')
  const [preview, setPreview] = useState<TranscriptPreview | null>(null)
  useEffect(() => {
    if (!transcribed) return
    let stale = false
    api
      .transcript(projectName)
      .then((answer) => !stale && setPreview(answer))
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [projectName, transcribed, picked])

  const detail = (step: string, state: StepState): string => {
    if (state === 'active') return STEP_TEXT[step].active
    if (state === 'pending') return 'កំពុងរង់ចាំ'
    if (state === 'cached') return 'រួចរាល់ពីមុន (cache)'
    if (step === 'transcribe') return `រួចរាល់ · ដំណើរការលើ ${(preview?.device ?? device) === 'cuda' ? 'GPU' : 'CPU'}`
    if (step === 'highlights' && preview?.candidates.length)
      return `រួចរាល់ · AI ពិចារណា ${khmerNumber(preview.candidates.length)} clip`
    return 'រួចរាល់'
  }

  const subtitle = [videoName, preview?.duration ? clock(preview.duration) : null, 'English', runLabel]
    .filter(Boolean)
    .join(' · ')
  const problem = error || status.error

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb={projectName} onHome={onHome}>
        <AccountButton />
      </TopBar>

      <main className="min-h-0 flex-1 overflow-y-auto px-8 pt-10 pb-8 [scrollbar-gutter:stable]">
        <div className="mx-auto flex max-w-[1040px] flex-col gap-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="type-page">{HEADLINE[status.state]}</h1>
              <p className="mt-1 type-body break-all text-text-3">{subtitle}</p>
            </div>
            <div className="flex gap-2">
              {running ? (
                <>
                  {/* design មានប៊ូតុងផ្អាក; pipeline មិនអាចផ្អាកបានទេ — បោះបង់បាន */}
                  <Button disabled title="មិនទាន់មាន — អាចបោះបង់បាន">
                    ផ្អាក
                  </Button>
                  <Button onClick={onCancel}>បោះបង់</Button>
                </>
              ) : status.state === 'done' ? (
                <Button variant="primary" onClick={onReview}>
                  មើល Clips
                </Button>
              ) : (
                <Button onClick={onBack}>ត្រឡប់ក្រោយ</Button>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex justify-between type-body">
              <span className="font-semibold">
                ជំហាន {khmerNumber(finished)} / {khmerNumber(status.progress.total)} រួចរាល់
              </span>
              <span className="text-text-3">រយៈពេល {clock(elapsed)}</span>
            </div>
            <Progress value={(finished / status.progress.total) * 100} label="ជំហានដែលរួចរាល់" />
          </div>

          <div className="flex flex-wrap items-stretch gap-6">
            <ol className="m-0 flex min-w-0 flex-[1_1_340px] list-none flex-col gap-1 rounded-card border border-line bg-[#141821] p-5">
              {STEPS.map((step, index) => (
                <StepRow key={step} state={states[index]} title={STEP_TEXT[step].title} detail={detail(step, states[index])} />
              ))}
            </ol>
            <Live preview={preview} log={log} />
          </div>

          {problem && (
            <p className="rounded-[12px] border border-line bg-card px-4.5 py-3.5 type-body whitespace-pre-wrap text-danger">
              {problem}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-line bg-[#161B24] px-4.5 py-3.5">
            <p className="flex items-center gap-2.5 type-body text-text-2">
              <InfoIcon />
              {running
                ? 'កុំបិទ app ពេលកំពុងដំណើរការ — ការបិទវាបញ្ឈប់ការងារ។ អ្នកអាចបង្រួម (minimize) window បាន។'
                : 'Clips ទាំងអស់នៅលើកុំព្យូទ័រនេះ — គ្មានអ្វីត្រូវបាន upload ទេ។'}
            </p>
            <button
              type="button"
              onClick={onReview}
              disabled={status.state !== 'done'}
              className="cursor-pointer border-0 bg-transparent p-0 type-body font-semibold text-gold disabled:cursor-default disabled:opacity-40"
            >
              មើល Clips
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

/** ជំហានមួយ: រួច = ធីកបៃតង, cache = ធីកស្រាល, កំពុងរត់ = រង្វង់វិល + ផ្ទៃភ្លឺ, រង់ចាំ = រង្វង់ទទេ. */
/** transcript ពិត (បន្ទាត់ដែល AI ពិចារណាជា clip ត្រូវបន្លិច) ឬ log របស់ pipeline. */
function Live({ preview, log }: { preview: TranscriptPreview | null; log: string[] }) {
  const segments = preview?.segments ?? []
  const [tab, setTab] = useState<'transcript' | 'log'>('transcript')
  const showing = segments.length ? tab : 'log' // មុន transcribe ចប់ មានតែ log
  const list = useRef<HTMLDivElement>(null)

  const hit = (start: number, end: number) =>
    (preview?.candidates ?? []).some((clip) => start < clip.end && end > clip.start)

  // ពេល clip ដែល AI ពិចារណាមកដល់ រមូរទៅបន្ទាត់បន្លិចទីមួយ; log រមូរទៅបន្ទាត់ចុងក្រោយ
  const candidates = preview?.candidates.length ?? 0
  useEffect(() => {
    if (showing === 'transcript') list.current?.querySelector('[data-hit]')?.scrollIntoView({ block: 'center' })
  }, [showing, candidates])
  useEffect(() => {
    if (showing === 'log' && list.current) list.current.scrollTop = list.current.scrollHeight
  }, [showing, log.length])

  return (
    <section className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-3 rounded-card border border-line bg-[#141821] p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{showing === 'transcript' ? 'Transcript' : 'កំណត់ហេតុ (log)'}</h2>
        <Segmented
          label="បង្ហាញ"
          shape="pill"
          value={showing}
          onChange={setTab}
          options={[
            { value: 'transcript', label: 'Transcript', disabled: segments.length === 0 },
            { value: 'log', label: 'Log' },
          ]}
        />
      </div>

      <div ref={list} className="max-h-[380px] min-h-[200px] overflow-y-auto pr-1">
        {showing === 'transcript' ? (
          <div className="flex flex-col gap-2.5 text-[15px] leading-[1.75]">
            {segments.map((segment) => {
              const marked = hit(segment.start, segment.end)
              return (
                <p
                  key={segment.start}
                  data-hit={marked || undefined}
                  className={`m-0 flex gap-3.5 ${marked ? '-ml-2 rounded-field bg-gold-tint px-2 py-1.5' : ''}`}
                >
                  <span className={`w-[52px] shrink-0 pt-1 text-[12px] ${marked ? 'text-gold' : 'text-text-4'}`}>
                    {clock(segment.start)}
                  </span>
                  <span>{segment.text}</span>
                </p>
              )
            })}
          </div>
        ) : (
          <div className="font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-text-3">
            {log.length === 0 ? 'កំពុងចាប់ផ្តើម...' : log.slice(-300).join('\n')}
          </div>
        )}
      </div>

      <p className="flex items-center gap-2 text-[12px] text-text-3">
        {showing === 'transcript' && candidates > 0 ? (
          <>
            <span className="size-2 rounded-full bg-gold" />
            បន្ទាត់ដែលបន្លិច = AI កំពុងពិចារណាជា clip
          </>
        ) : showing === 'transcript' ? (
          `${khmerNumber(segments.length)} ប្រយោគ · AI នឹងបន្លិចបន្ទាត់ដែលវាជ្រើស`
        ) : (
          'Transcript នឹងលេចក្រោយជំហាន Transcribe'
        )}
      </p>
    </section>
  )
}
