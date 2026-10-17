import { useEffect, useRef, useState } from 'react'
import { clipFileUrl, clipThumbUrl, type Clip, type Grades } from '../api'
import { parseVtt, type Cue } from '../vtt'
import { Badge } from './Badge'
import { ExportDialog } from './ExportDialog'
import rerunIcon from '../assets/figma/rerun.svg'
import exportIcon from '../assets/figma/export.svg'
import applyIcon from '../assets/figma/apply.svg'
import thumbPlay from '../assets/figma/thumb-play.svg'
import tabCaptions from '../assets/figma/tab-captions.svg'
import tabReframe from '../assets/figma/tab-reframe.svg'
import tabCleanup from '../assets/figma/tab-cleanup.svg'
import chevron from '../assets/figma/chevron.svg'

/** Screen "04 · Review & Edit" (Figma node 7:2), ភ្ជាប់ទៅ clip ពិត.
 *  Design បង្ហាញ waveform, speaker label និង toggle ដែល pipeline មិនទាន់មាន —
 *  ទីនេះ transcript មកពី `.vtt` ពិត ហើយពិន្ទុមកពី rubric ពិត. */
export function Review({
  project,
  clips,
  captionWords,
  captionColor,
  onCaptionWords,
  onCaptionColor,
  onRerender,
  busy,
}: {
  project: string
  clips: Clip[]
  captionWords: number
  captionColor: string
  onCaptionWords: (count: number) => void
  onCaptionColor: (color: string) => void
  onRerender: () => void
  busy: boolean
}) {
  const [selected, setSelected] = useState(clips[0]?.index ?? 1)
  const [exporting, setExporting] = useState(false)
  const clip = clips.find((c) => c.index === selected) ?? clips[0]
  const video = useRef<HTMLVideoElement>(null)

  if (!clip) return null

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
      <header className="flex items-center gap-3 border-b border-border-default px-6 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-title text-text-primary">{project}</p>
            <Badge label="PHASE 0 PIPELINE" />
          </div>
          <p className="text-caption text-text-secondary">
            {clips.length} clips · {clips.filter((c) => c.letter.startsWith('A')).length} graded A ·
            keyword {captionColor}
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={onRerender}
          disabled={busy}
          className="flex items-center gap-2 rounded-sm px-4 py-2.5 text-body-strong text-text-primary disabled:opacity-40"
        >
          <img src={rerunIcon} alt="" width={16} height={16} />
          {busy ? 'Rendering...' : 'Re-render clips'}
        </button>
        <button
          onClick={() => setExporting(true)}
          className="flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
        >
          <img src={exportIcon} alt="" width={16} height={16} />
          Export clips
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex w-[320px] shrink-0 flex-col gap-2.5 overflow-y-auto border-r border-border-default p-4">
          <div className="flex items-center gap-2">
            <p className="text-heading text-text-primary">Suggested clips</p>
            <Badge label={String(clips.length)} />
          </div>
          {clips.map((item) => (
            <button
              key={item.index}
              onClick={() => setSelected(item.index)}
              className={`flex w-full items-stretch gap-3 rounded-md border p-2.5 text-left ${
                item.index === selected
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-default bg-bg-card hover:bg-bg-hover'
              }`}
            >
              <Thumb project={project} index={item.index} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-body-strong text-text-primary">
                  #{item.index} {item.title}
                </p>
                <p className="text-caption text-text-secondary">
                  {formatTime(item.start)} · {item.duration.toFixed(0)}s
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge label={`SCORE ${Math.round(item.total)}`} />
                  {item.type && <Badge label={item.type.toUpperCase()} tone="muted" />}
                </div>
              </div>
            </button>
          ))}
        </section>

        <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex items-center justify-center rounded-lg bg-bg-panel p-4">
            <video
              ref={video}
              key={clip.index}
              src={clipFileUrl(project, clip.index, 'mp4')}
              controls
              className="max-h-[420px] rounded-md bg-black"
            />
          </div>
          <Transcript project={project} clip={clip} onSeek={(at) => seek(video.current, at)} />
        </section>

        <section className="flex w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border-default p-4">
          <div className="flex gap-1">
            <Tab icon={tabCaptions} label="Captions" active />
            <Tab icon={tabReframe} label="Reframe" />
            <Tab icon={tabCleanup} label="Cleanup" />
          </div>

          <WhyPicked clip={clip} />

          <div>
            <p className="mb-2 text-label text-text-secondary">CAPTION STYLE</p>
            <Field label="Words a cue">
              <input
                type="number"
                min={2}
                max={8}
                value={captionWords}
                onChange={(e) => onCaptionWords(Number(e.target.value))}
                className="w-full bg-transparent text-body text-text-primary outline-none"
              />
            </Field>
            <Field label="Keyword color">
              <input
                type="text"
                value={captionColor}
                onChange={(e) => onCaptionColor(e.target.value)}
                className="w-full bg-transparent text-body text-text-primary outline-none"
              />
              <span
                className="size-4 shrink-0 rounded-full border border-border-strong"
                style={{ background: captionColor }}
              />
            </Field>
            <p className="mt-2 text-caption text-text-secondary">
              Changing these re-renders every clip (`--redo render`), it does not re-transcribe.
            </p>
          </div>

          <button
            onClick={onRerender}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent disabled:opacity-40"
          >
            <img src={applyIcon} alt="" width={16} height={16} />
            Apply style to all clips
          </button>
        </section>
      </div>
    </div>
  )
}

function Thumb({ project, index }: { project: string; index: number }) {
  const [failed, setFailed] = useState(false)
  if (failed)
    return (
      <div className="flex h-[78px] w-11 shrink-0 items-center justify-center rounded-sm bg-bg-hover">
        <img src={thumbPlay} alt="" width={16} height={16} />
      </div>
    )
  return (
    <img
      src={clipThumbUrl(project, index)}
      alt=""
      onError={() => setFailed(true)}
      className="h-[78px] w-11 shrink-0 rounded-sm bg-bg-hover object-cover"
    />
  )
}

function WhyPicked({ clip }: { clip: Clip }) {
  const parts: [keyof Grades, string][] = [
    ['hook', 'Hook'],
    ['flow', 'Flow'],
    ['value', 'Value'],
  ]
  return (
    <div className="rounded-md border border-border-default bg-bg-card p-3">
      <p className="mb-1 text-body-strong text-text-primary">Why AI picked this clip</p>
      <p className="mb-3 text-caption text-text-secondary">{clip.reason || clip.hook}</p>
      {clip.grades ? (
        parts.map(([key, label]) => (
          <Bar
            key={key}
            label={label}
            score={clip.grades![key].score}
            letter={clip.grades![key].letter}
            reason={clip.grades![key].reason}
          />
        ))
      ) : (
        <p className="text-caption text-text-secondary">
          This clip was scored before the rubric existed — only a total is stored.
        </p>
      )}
      <Bar label="Total" score={clip.total} letter={clip.letter} />
    </div>
  )
}

function Bar({
  label,
  score,
  letter,
  reason,
}: {
  label: string
  score: number
  letter: string
  reason?: string
}) {
  return (
    <div className="mb-2" title={reason}>
      <div className="flex items-center gap-2">
        <span className="w-20 shrink-0 text-caption text-text-secondary">{label}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-hover">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        </span>
        <span className="w-14 shrink-0 text-right text-caption text-text-primary">
          {Math.round(score)} {letter}
        </span>
      </div>
    </div>
  )
}

function Transcript({
  project,
  clip,
  onSeek,
}: {
  project: string
  clip: Clip
  onSeek: (at: number) => void
}) {
  const [cues, setCues] = useState<Cue[]>([])
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    setCues([])
    setMissing(false)
    fetch(clipFileUrl(project, clip.index, 'vtt'))
      .then((answer) => (answer.ok ? answer.text() : Promise.reject(new Error('no vtt'))))
      .then((text) => setCues(parseVtt(text)))
      .catch(() => setMissing(true))
  }, [project, clip.index])

  return (
    <div className="rounded-lg border border-border-default bg-bg-panel p-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-body-strong text-text-primary">Transcript</p>
        <Badge label={`${cues.length} CUES`} tone="muted" />
        <div className="flex-1" />
        <p className="text-caption text-text-secondary">click a line to jump</p>
      </div>
      {missing && (
        <p className="text-caption text-text-secondary">
          No .vtt beside this clip — re-render it to write the sidecars.
        </p>
      )}
      <div className="max-h-56 overflow-y-auto">
        {cues.map((cue, index) => (
          <button
            key={index}
            onClick={() => onSeek(cue.start)}
            className="flex w-full gap-3 rounded px-1 py-0.5 text-left hover:bg-bg-hover"
          >
            <span className="w-12 shrink-0 text-caption text-text-secondary">
              {cue.start.toFixed(1)}s
            </span>
            <span className="text-body text-text-primary">{cue.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Tab({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  return (
    <div
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 ${
        active ? 'bg-accent-soft text-text-primary' : 'text-text-secondary'
      }`}
      title={active ? undefined : 'Phase 2'}
    >
      <img src={icon} alt="" width={16} height={16} />
      <span className="text-caption">{label}</span>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-caption text-text-secondary">{label}</p>
      <div className="flex items-center gap-2 rounded-sm border border-border-default bg-bg-card px-3 py-2.5">
        {children}
        <img src={chevron} alt="" width={16} height={16} className="shrink-0 opacity-50" />
      </div>
    </div>
  )
}

function seek(video: HTMLVideoElement | null, at: number) {
  if (!video) return
  video.currentTime = at
  void video.play()
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
