import { useEffect, useState } from 'react'
import { api, type CleanupAnswer, type CleanupSuggestion } from '../api'
import { Button } from '../kit/controls'
import { focusRing } from '../kit/styles'
import { khmerNumber } from './khmer'

const PAUSES = [0.5, 1, 2]

/** Speech cleanup: pause វែង + ពាក្យ "អឺ" ដែល sidecar ស្នើ (`/cleanup`) — **អ្នកពិនិត្យ** រួចលុប.
 *
 *  ការស្នើនីមួយៗមាន checkbox (ធីកលំនាំដើម) និងពេល (ចុច = លោតទៅមើល). "I mean" / "you know"
 *  ពេលខ្លះមានអត្ថន័យ ដូច្នេះមិនកាត់ដោយខ្លួនឯងទេ. Edit Video និងកាត "លុបភាពស្ងាត់" ប្រើរួមគ្នា. */
export function CleanupPanel({
  project,
  onSeek,
  onApply,
  onChange,
  applyLabel = 'លុបដែលបានជ្រើស',
}: {
  project: string
  onSeek?: (seconds: number) => void
  onApply?: (picked: CleanupSuggestion[]) => void // គ្មាន = គ្មានប៊ូតុង (dialog មានប៊ូតុងខ្លួនឯង)
  onChange?: (picked: CleanupSuggestion[]) => void // ការស្នើដែលធីក រាល់ពេលវាប្តូរ (setState មិនប្តូរ)
  applyLabel?: string
}) {
  const [pause, setPause] = useState(1)
  const [fillers, setFillers] = useState(true)
  const [answer, setAnswer] = useState<CleanupAnswer | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set()) // ការស្នើដែលដកធីក (តាម start)
  const [failed, setFailed] = useState('')

  const key = `${project}|${pause}|${fillers}`
  const [loadedKey, setLoadedKey] = useState('')
  useEffect(() => {
    let stale = false
    api
      .cleanup(project, pause, fillers)
      .then((data) => {
        if (stale) return
        setAnswer(data)
        setLoadedKey(key)
        setSkipped(new Set())
        setFailed('')
      })
      .catch((error: Error) => !stale && setFailed(error.message))
    return () => {
      stale = true
    }
  }, [project, pause, fillers, key])

  const loading = loadedKey !== key
  const list = answer?.suggestions ?? []
  const picked = list.filter((item) => !skipped.has(item.start))
  const seconds = picked.reduce((sum, item) => sum + item.end - item.start, 0)
  // ប្រាប់មេ (dialog លុបភាពស្ងាត់) នូវអ្វីដែលធីក — ក្នុង effect មិនមែនពេល render
  useEffect(() => {
    if (!onChange) return
    onChange(loading ? [] : (answer?.suggestions ?? []).filter((item) => !skipped.has(item.start)))
  }, [answer, skipped, loading, onChange])
  const toggle = (start: number) =>
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <span className="type-label font-semibold">Speech cleanup</span>
      <div className="flex flex-col gap-1.5">
        <span className="type-hint text-text-3">Pause វែងជាង</span>
        <div role="group" aria-label="Pause វែងជាង" className="flex gap-1.5">
          {PAUSES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={pause === value}
              onClick={() => setPause(value)}
              className={`min-h-8 flex-1 cursor-pointer rounded-field border-0 type-label ${
                pause === value ? 'bg-gold text-on-gold font-bold' : 'bg-raised text-text-2 hover:bg-raised-2'
              } ${focusRing}`}
            >
              {value} s
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 type-label text-text-2">
        <input
          type="checkbox"
          checked={fillers}
          onChange={(event) => setFillers(event.target.checked)}
          className={`size-4 cursor-pointer accent-gold ${focusRing}`}
        />
        ពាក្យ "អឺ" (um, uh, you know, I mean)
      </label>
      <p className="m-0 type-hint text-text-4">Whisper ច្រើនតែមិនសរសេរ um / uh ទេ — រកឃើញតែអ្វីដែលវាសរសេរ។ ពិនិត្យមុនលុប។</p>

      {failed ? (
        <p className="type-hint text-danger">{failed}</p>
      ) : loading ? (
        <p className="type-hint text-text-4">…</p>
      ) : !answer?.ready ? (
        <p className="type-hint text-text-4">គ្មាន transcript</p>
      ) : (
        <>
          <p className="m-0 type-body">
            <strong>{khmerNumber(answer.pauses)}</strong> pause · <strong>{khmerNumber(answer.fillers)}</strong> filler ·{' '}
            <strong className="text-gold">{seconds.toFixed(1)} s</strong>
          </p>
          <ul className="m-0 flex max-h-[300px] min-h-0 flex-col gap-0.5 overflow-y-auto p-0">
            {list.map((item) => (
              <li key={item.start} className="flex list-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={!skipped.has(item.start)}
                  onChange={() => toggle(item.start)}
                  aria-label={`${item.reason} ${item.text}`}
                  className={`size-4 cursor-pointer accent-gold ${focusRing}`}
                />
                <button
                  type="button"
                  onClick={() => onSeek?.(Math.max(0, item.start - 1))}
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-field border-0 bg-transparent px-1.5 py-1 text-left type-hint text-text-2 hover:bg-field ${focusRing}`}
                >
                  <span className="w-12 shrink-0 text-text-4 tabular-nums">{clockShort(item.start)}</span>
                  <span className={`rounded-[4px] px-1.5 ${item.reason === 'pause' ? 'bg-raised-2' : 'bg-gold-tint text-gold'}`}>
                    {item.text}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {onApply && (
            <Button variant="primary" disabled={picked.length === 0} onClick={() => onApply(picked)}>
              {applyLabel} ({khmerNumber(picked.length)})
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function clockShort(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
