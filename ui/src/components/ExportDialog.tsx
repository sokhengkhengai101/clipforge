import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ExportPreview, type ExportResult, type VideoFormat } from '../api'
import { Badge } from './Badge'
import closeIcon from '../assets/figma/close.svg'
import checkIcon from '../assets/figma/check-box.svg'
import exportIcon from '../assets/figma/export.svg'
import toggleOn from '../assets/figma/toggle-on.svg'
import toggleOff from '../assets/figma/toggle-off.svg'

/** Screen "05 · Export dialog" (Figma node 11:943) — modal ពីលើ Review.
 *
 *  Export **ចម្លង** file ដែល render រួច; វាមិន render ឡើងវិញទេ. ដូច្នេះជួរខ្លះ
 *  ក្នុង design មានន័យខុសបន្តិច ហើយវាសរសេរប្រាប់ជំនួសការធ្វើពុត:
 *  - PLATFORM PRESET ក្លាយជា **ព័ត៌មាន** ("clip ទាំងនេះសមនឹង TikTok/Reels/Shorts"),
 *    ព្រោះការប្តូរទៅ 16:9 ជាការ render មិនមែនការចម្លង.
 *  - Burn captions បើករួចជាស្ថាពរ — caption ត្រូវដុតចូលតាំងពី render.
 *  - Brand logo ជារបស់ Phase 3.
 */
export function ExportDialog({ project, onClose }: { project: string; onClose: () => void }) {
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [subtitles, setSubtitles] = useState(true)
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState('')

  // យើងសុំ kind ទាំងបី​ម្តងជាស្រេច រួចច្រោះខាង client ពេល toggle ប្តូរ —
  // បើមិនដូច្នោះ toggle នីមួយៗនឹងទៅសួរ server ម្តងទៀតដោយឥតប្រយោជន៍.
  useEffect(() => {
    api
      .exportPreview(project, ['mp4', 'srt', 'vtt'])
      .then((found) => {
        setPreview(found)
        setDestination(found.destination)
        setChosen(new Set(found.clips.map((clip) => clip.index)))
      })
      .catch((e: Error) => setError(e.message))
  }, [project])

  // Escape បិទ dialog — អ្វីដែលអ្នកប្រើរំពឹងពី modal គ្រប់កន្លែង.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const kinds = useMemo(() => (subtitles ? ['mp4', 'srt', 'vtt'] : ['mp4']), [subtitles])

  /** file ដែលនឹងត្រូវចម្លងពិត = clip ដែលធីក x kind ដែលបើក x file ដែលមានលើ disk. */
  const picked = useMemo(() => {
    if (!preview) return []
    return preview.clips
      .filter((clip) => chosen.has(clip.index))
      .flatMap((clip) => clip.files.filter((file) => kinds.includes(file.kind)))
  }, [preview, chosen, kinds])

  const videos = picked.filter((file) => file.kind === 'mp4').length
  const subs = picked.length - videos
  const totalMb = picked.reduce((sum, file) => sum + file.bytes, 0) / 1e6

  const toggleClip = useCallback((index: number) => {
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(index)) next.add(index)
      return next
    })
  }, [])

  const runExport = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await api.exportClips(project, { destination, clips: [...chosen], kinds }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [project, destination, chosen, kinds])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-10">
      {/* Scrim: ចុចខាងក្រៅបិទ dialog. `stopPropagation` ខាងក្នុងការពារការបិទដោយចៃដន្យ. */}
      <div className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Export clips"
        className="relative flex w-[600px] flex-col gap-5 rounded-lg border border-border-default bg-bg-panel px-6 py-5.5 shadow-[0_24px_64px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-title text-text-primary">
              Export {videos} clip{videos === 1 ? '' : 's'}
            </p>
            <p className="text-caption text-text-secondary">
              Copied from output/ as they are — nothing is uploaded, nothing is re-rendered.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0">
            <img src={closeIcon} alt="" width={20} height={20} />
          </button>
        </header>

        {error && (
          <p className="rounded-sm border border-border-default bg-bg-card px-3 py-2 text-caption text-red-400">
            {error}
          </p>
        )}

        {result ? (
          <Done result={result} onClose={onClose} />
        ) : (
          <>
            <div className="flex flex-col overflow-hidden rounded-md border border-border-default">
              {preview?.clips.length === 0 && (
                <p className="px-3.5 py-2.5 text-caption text-text-secondary">
                  គ្មាន clip ដែល render រួច — Review មុន Export.
                </p>
              )}
              {preview?.clips.map((clip, row) => {
                const mp4 = clip.files.find((file) => file.kind === 'mp4')
                return (
                  <button
                    key={clip.index}
                    onClick={() => toggleClip(clip.index)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-bg-hover ${
                      row < preview.clips.length - 1 ? 'border-b border-border-default' : ''
                    }`}
                  >
                    <span
                      className={`flex size-[18px] shrink-0 items-center justify-center rounded-sm ${
                        chosen.has(clip.index)
                          ? 'bg-accent'
                          : 'border border-border-strong bg-bg-card'
                      }`}
                    >
                      {chosen.has(clip.index) && (
                        <img src={checkIcon} alt="" width={12} height={12} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                      #{clip.index} {clip.title}
                    </span>
                    <span className="shrink-0 text-caption text-text-secondary">
                      {clip.files.map((file) => file.kind).join(' · ')}
                    </span>
                    <span className="w-[52px] shrink-0 text-right text-caption text-text-secondary">
                      {mp4 ? `${mp4.mb.toFixed(1)} MB` : '—'}
                    </span>
                  </button>
                )
              })}
            </div>

            <PlatformFit format={preview?.format ?? null} />

            <div className="flex gap-3">
              <Field label="Resolution" value={resolutionOf(preview?.format ?? null)} />
              <Field label="Quality" value={qualityOf(preview?.format ?? null)} />
            </div>

            <div className="flex flex-col gap-3">
              <Option
                title="Burn captions into video"
                note="Already burned at render — Re-render clips to restyle"
                state
                locked
              />
              <Option
                title="Export subtitle files"
                note={`SRT + VTT beside each .mp4 (${subs} file${subs === 1 ? '' : 's'} selected)`}
                state={subtitles}
                onChange={() => setSubtitles((on) => !on)}
              />
              <Option
                title="Add brand logo & outro"
                note="Brand kits"
                state={false}
                locked
                badge="PHASE 3"
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-text-secondary">Output folder</span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                spellCheck={false}
                className="rounded-sm border border-border-default bg-bg-card px-3 py-2 text-body text-text-primary outline-none focus:border-border-strong"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-caption text-text-secondary">File name</span>
              <p className="rounded-sm border border-border-default bg-bg-card px-3 py-2 text-body text-text-secondary">
                {'{clip_no} - {title}.mp4'} — numbered so sorting by name keeps the ranking
              </p>
            </div>

            <footer className="flex items-center gap-2">
              <p className="text-caption text-text-secondary">
                {videos} video{videos === 1 ? '' : 's'}
                {subs > 0 && ` + ${subs} subtitle file${subs === 1 ? '' : 's'}`} ·{' '}
                {totalMb.toFixed(1)} MB
              </p>
              <div className="flex-1" />
              <button onClick={onClose} className="rounded-sm px-4 py-2.5 text-body-strong">
                Cancel
              </button>
              <button
                onClick={runExport}
                disabled={busy || picked.length === 0}
                className="flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent disabled:opacity-40"
              >
                <img src={exportIcon} alt="" width={16} height={16} />
                {busy ? 'Copying...' : `Export ${videos} clip${videos === 1 ? '' : 's'}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

/** អ្វីដែលកើតឡើងបន្ទាប់ពីចម្លងរួច — path ពិត និងប៊ូតុងបើក folder. */
function Done({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const [opened, setOpened] = useState('')
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border-default bg-bg-card p-4">
        <p className="text-body-strong text-success">
          Copied {result.files.length} file{result.files.length === 1 ? '' : 's'} ·{' '}
          {result.mb.toFixed(1)} MB
        </p>
        <p className="mt-1 break-all text-caption text-text-secondary">{result.destination}</p>
        <ul className="mt-3 flex flex-col gap-1">
          {result.files.map((file) => (
            <li key={file.path} className="truncate text-caption text-text-primary">
              {file.name}
            </li>
          ))}
        </ul>
        {result.skipped.length > 0 && (
          <p className="mt-3 text-caption text-warning">
            {result.skipped.length} skipped: {result.skipped[0].reason}
          </p>
        )}
      </div>
      <footer className="flex items-center gap-2">
        <p className="text-caption text-text-secondary">{opened}</p>
        <div className="flex-1" />
        <button
          onClick={() =>
            api
              .reveal(result.destination)
              .catch((e: Error) => setOpened(e.message))
          }
          className="rounded-sm border border-border-default px-4 py-2.5 text-body-strong text-text-primary hover:bg-bg-hover"
        >
          Open folder
        </button>
        <button
          onClick={onClose}
          className="rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
        >
          Done
        </button>
      </footer>
    </div>
  )
}

const PLATFORMS = [
  { label: 'TikTok', ratio: '9:16' },
  { label: 'Reels', ratio: '9:16' },
  { label: 'Shorts', ratio: '9:16' },
  { label: 'YouTube', ratio: '16:9' },
  { label: 'Custom', ratio: 'any' },
]

/** ជួរ PLATFORM របស់ design ជា **ព័ត៌មាន** មិនមែន control: Export ចម្លង file
 *  ដែលមានស្រាប់ ហើយការប្តូរ aspect ជាការ render ថ្មី (`--aspect 16:9`). */
function PlatformFit({ format }: { format: VideoFormat | null }) {
  const ratio = ratioOf(format)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label text-text-secondary">PLATFORM FIT · {ratio ?? 'unknown'}</p>
      <div className="flex gap-1 rounded-sm bg-bg-card p-1">
        {PLATFORMS.map((platform) => {
          const fits = platform.ratio === 'any' || platform.ratio === ratio
          return (
            <span
              key={platform.label}
              title={fits ? 'These clips fit' : `Needs a re-render at ${platform.ratio}`}
              // ពណ៌ទន់ (មិនមែន accent ពេញ) ព្រោះនេះជាការប្រាប់ថា "សម" —
              // មិនមែនប៊ូតុងដែលអ្នកទើបជ្រើស.
              className={`flex-1 rounded-sm py-1.5 text-center text-body ${
                fits ? 'bg-accent-soft text-accent' : 'text-text-secondary opacity-40'
              }`}
            >
              {platform.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-caption text-text-secondary">{label}</span>
      <p className="rounded-sm border border-border-default bg-bg-card px-3 py-2 text-body text-text-primary">
        {value}
      </p>
    </div>
  )
}

function Option({
  title,
  note,
  state,
  locked,
  badge,
  onChange,
}: {
  title: string
  note: string
  state: boolean
  locked?: boolean
  badge?: string
  onChange?: () => void
}) {
  return (
    <div className={`flex items-center gap-3 ${locked ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-body text-text-primary">
          {title}
          {badge && <Badge label={badge} tone="muted" />}
        </p>
        <p className="text-caption text-text-secondary">{note}</p>
      </div>
      <button
        onClick={onChange}
        disabled={locked}
        aria-label={title}
        aria-pressed={state}
        className="shrink-0"
      >
        <img src={state ? toggleOn : toggleOff} alt="" width={36} height={20} />
      </button>
    </div>
  )
}

/** 1080x1920 -> "9:16". យើងប្រៀបនឹង aspect ដែល pipeline ចេះធ្វើ រួចយកមួយជិតបំផុត. */
function ratioOf(format: VideoFormat | null): string | null {
  if (!format?.width || !format?.height) return null
  const value = format.width / format.height
  const known: [string, number][] = [
    ['9:16', 9 / 16],
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['16:9', 16 / 9],
  ]
  return known.reduce((best, item) =>
    Math.abs(item[1] - value) < Math.abs(best[1] - value) ? item : best,
  )[0]
}

function resolutionOf(format: VideoFormat | null): string {
  if (!format?.width) return '—'
  const fps = format.fps ? ` · ${format.fps} fps` : ''
  return `${format.width} × ${format.height}${fps}`
}

function qualityOf(format: VideoFormat | null): string {
  if (!format?.codec) return '—'
  const rate = format.kbps ? ` · ${(format.kbps / 1000).toFixed(1)} Mbps` : ''
  return `${format.codec.toUpperCase()}${rate}`
}
