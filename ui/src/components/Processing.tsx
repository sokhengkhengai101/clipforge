import { useEffect, useRef } from 'react'
import { STEPS, type Clip, type JobStatus } from '../api'
import { Badge } from './Badge'
import { StepItem, stepStates } from './Pipeline'
import cancelIcon from '../assets/figma/cancel.svg'
import transcriptIcon from '../assets/figma/transcript.svg'
import clipsIcon from '../assets/figma/clips.svg'
import playIcon from '../assets/figma/play.svg'
import reviewIcon from '../assets/figma/review.svg'

/** Screen "03 · Processing" (Figma node 10:414), ភ្ជាប់ទៅ job ពិត.
 *  Design មាន "Live transcript" និង stat ដូចជា SPEAKERS / GPU LOAD ដែល
 *  pipeline យើងមិនទាន់មាន — កន្លែងនោះដាក់ log ពិត និងលេខដែលយើងដឹងពិត. */
export function Processing({
  status,
  log,
  clips,
  videoName,
  error,
  onCancel,
  onReview,
  onBack,
}: {
  status: JobStatus
  log: string[]
  clips: Clip[]
  videoName: string
  error: string
  onCancel: () => void
  onReview: () => void
  onBack: () => void
}) {
  const states = stepStates(status.progress, STEPS)
  const finished = status.progress.done.length
  const percent = Math.round((finished / status.progress.total) * 100)
  const running = status.state === 'running'

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-5 overflow-auto px-8 py-6">
      <header className="flex w-full items-center gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={onBack}
            className="text-caption text-text-secondary hover:text-text-primary"
          >
            &larr; Projects
          </button>
          <p className="truncate text-title text-text-primary">
            {running ? 'Analyzing' : 'Finished'} {videoName}
          </p>
          <p className="text-caption text-text-secondary">
            job {status.id} · {status.seconds.toFixed(0)}s · {status.progress.cached.length} steps
            from cache
          </p>
        </div>
        {running && (
          <button
            onClick={onCancel}
            className="flex items-center gap-2 rounded-sm border border-border-default bg-bg-card px-4 py-2.5 text-body-strong text-text-primary"
          >
            <img src={cancelIcon} alt="" width={16} height={16} />
            Cancel
          </button>
        )}
      </header>

      <section className="flex w-full flex-col gap-3.5 rounded-lg border border-border-default bg-bg-panel px-5 py-4">
        <div className="flex w-full items-end gap-4">
          <p className="text-display text-text-primary">{percent}%</p>
          <div>
            <p className="text-body-strong text-text-primary">
              {status.progress.step === 'starting' ? 'Starting' : status.progress.step}
            </p>
            <p className="text-caption text-text-secondary">
              step {finished} of {status.progress.total}
            </p>
          </div>
          <div className="flex-1" />
          <div className="flex gap-7">
            <Stat label="STATE" value={status.state} />
            <Stat label="ELAPSED" value={`${status.seconds.toFixed(0)}s`} />
            <Stat label="LOG LINES" value={String(status.log_lines)} />
            <Stat label="CLIPS" value={clips.length ? String(clips.length) : '—'} />
          </div>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-hover">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </section>

      <div className="flex min-h-0 w-full flex-1 gap-5">
        <section className="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-border-default bg-bg-panel px-5 py-4">
          <div className="flex w-full items-center gap-2">
            <p className="text-heading text-text-primary">AI pipeline</p>
            <div className="flex-1" />
            <Badge label="RUNNING LOCALLY" tone="success" />
          </div>
          {STEPS.map((step, index) => (
            <StepItem key={step} step={step} state={states[index]} />
          ))}
        </section>

        <div className="flex w-[440px] shrink-0 flex-col gap-5">
          <LogCard log={log} />
          <ClipsCard clips={clips} error={error || status.error} onReview={onReview} />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-label text-text-secondary">{label}</p>
      <p className="text-heading text-text-primary">{value}</p>
    </div>
  )
}

function LogCard({ log }: { log: string[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => bottom.current?.scrollIntoView(), [log.length])
  return (
    <section className="flex max-h-72 flex-col gap-3 rounded-lg border border-border-default bg-bg-panel px-4 py-4">
      <div className="flex w-full items-center gap-2">
        <img src={transcriptIcon} alt="" width={16} height={16} />
        <p className="text-body-strong text-text-primary">Pipeline log</p>
        <div className="flex-1" />
        <p className="text-caption text-text-secondary">auto-scroll</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-caption text-text-secondary">
        {log.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap">
            {line}
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </section>
  )
}

function ClipsCard({
  clips,
  error,
  onReview,
}: {
  clips: Clip[]
  error: string
  onReview: () => void
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-lg border border-border-default bg-bg-panel px-4 py-4">
      <div className="flex w-full items-center gap-2">
        <img src={clipsIcon} alt="" width={16} height={16} />
        <p className="text-body-strong text-text-primary">Clips found so far</p>
        <div className="flex-1" />
        <Badge label={String(clips.length)} />
      </div>

      {error && <p className="text-caption text-red-400">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
        {clips.map((clip) => (
          <article
            key={clip.index}
            className="flex w-full items-center gap-3 rounded-md border border-border-default bg-bg-card p-2.5"
          >
            <div className="flex h-[78px] w-11 shrink-0 items-center justify-center rounded-sm bg-bg-hover">
              <img src={playIcon} alt="" width={16} height={16} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-strong text-text-primary">{clip.title}</p>
              <p className="truncate text-caption text-text-secondary">
                {formatTime(clip.start)} · {clip.duration.toFixed(0)}s
              </p>
              <div className="mt-1 flex gap-1.5">
                <Badge label={`SCORE ${Math.round(clip.total)}`} />
                {clip.letter && <Badge label={clip.letter} tone="muted" />}
                {clip.type && <Badge label={clip.type.toUpperCase()} tone="muted" />}
              </div>
            </div>
          </article>
        ))}
        {clips.length === 0 && (
          <p className="font-khmer text-body text-text-secondary">
            មិនទាន់មាន clip ទេ — វាលេចឡើងពេល pipeline ដល់ជំហាន render។
          </p>
        )}
      </div>

      {clips.length > 0 && (
        <button
          onClick={onReview}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
        >
          <img src={reviewIcon} alt="" width={16} height={16} />
          Start reviewing ({clips.length} ready)
        </button>
      )}
    </section>
  )
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
