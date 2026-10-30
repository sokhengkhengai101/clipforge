import { useEffect, useState, type ReactNode } from 'react'
import { api, type CleanupAnswer, type CleanupSuggestion } from '../api'
import { focusRing } from '../kit/styles'
import { useNum, useT } from '../i18n'

// Slider "Pause duration": sidecar ទទួល 0.1-10 s; 0.3-3 s គ្រប់ករណីពិត (pause ក្រោម 0.3 s មិនចូល /words ផង)
const PAUSE_MIN = 0.3
const PAUSE_MAX = 3
const PAUSE_ASK_MS = 300 // សួរ sidecar តែពេល slider ឈប់ 300 ms — មិនមែនរាល់ការរំកិល

type Kind = CleanupSuggestion['reason']

/** Speech cleanup (រូប OpusClip): កាត "N pauses found" ជាមួយ slider រយៈពេល, កាត "N filler words found"
 *  ជាមួយបញ្ជីបត់បាន, "Bad takes" (មិនទាន់មាន), និង Remove all.
 *
 *  ធីកកាតនីមួយៗ = រាប់ប្រភេទនោះចូល; ^ / v លោតទៅ pause / filler មុន / បន្ទាប់ ដើម្បីស្តាប់មុនលុប.
 *  "I mean" / "you know" ពេលខ្លះមានអត្ថន័យ — ដកធីកម្តងមួយៗក្នុង "មើល filler ទាំងអស់".
 *  Edit Video និងកាត "លុបភាពស្ងាត់" ប្រើរួមគ្នា. */
export function CleanupPanel({
  project,
  onSeek,
  onApply,
  onChange,
  applyLabel = 'Remove all',
}: {
  project: string
  onSeek?: (seconds: number) => void
  onApply?: (picked: CleanupSuggestion[]) => void // គ្មាន = គ្មានប៊ូតុង (dialog មានប៊ូតុងខ្លួនឯង)
  onChange?: (picked: CleanupSuggestion[]) => void // ការស្នើដែលធីក រាល់ពេលវាប្តូរ (setState មិនប្តូរ)
  applyLabel?: string
}) {
  const t = useT()
  const num = useNum()
  const [pause, setPause] = useState(0.5) // តម្លៃដែលបានសួរ sidecar
  const [pauseDraft, setPauseDraft] = useState(0.5) // តម្លៃលើ slider ពេលកំពុងអូស
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ pause: true, filler: true })
  const [answer, setAnswer] = useState<CleanupAnswer | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set()) // filler ដែលដកធីក (តាម start)
  const [cursor, setCursor] = useState<Record<Kind, number>>({ pause: -1, filler: -1 })
  const [showFillers, setShowFillers] = useState(false)
  const [failed, setFailed] = useState('')

  // slider ឈប់ 300 ms -> ទើបសួរ
  useEffect(() => {
    if (pauseDraft === pause) return
    const timer = setTimeout(() => setPause(pauseDraft), PAUSE_ASK_MS)
    return () => clearTimeout(timer)
  }, [pauseDraft, pause])

  // filler សួរជានិច្ច (fillers=true) ដើម្បីបង្ហាញចំនួន សូម្បីពេលដកធីក
  const key = `${project}|${pause}`
  const [loadedKey, setLoadedKey] = useState('')
  useEffect(() => {
    let stale = false
    api
      .cleanup(project, pause, true)
      .then((data) => {
        if (stale) return
        setAnswer(data)
        setLoadedKey(key)
        setCursor({ pause: -1, filler: -1 })
        setFailed('')
      })
      .catch((error: Error) => !stale && setFailed(error.message))
    return () => {
      stale = true
    }
  }, [project, pause, key])

  const loading = loadedKey !== key
  const list = answer?.suggestions ?? []
  const pauses = list.filter((item) => item.reason === 'pause')
  const fillers = list.filter((item) => item.reason === 'filler')
  const picked = list.filter((item) => kinds[item.reason] && !skipped.has(item.start))
  const seconds = picked.reduce((sum, item) => sum + item.end - item.start, 0)

  // ប្រាប់មេ (dialog លុបភាពស្ងាត់) នូវអ្វីដែលធីក — ក្នុង effect មិនមែនពេល render
  useEffect(() => {
    if (!onChange) return
    const all = answer?.suggestions ?? []
    onChange(loading ? [] : all.filter((item) => kinds[item.reason] && !skipped.has(item.start)))
  }, [answer, skipped, kinds, loading, onChange])

  const toggleOne = (start: number) =>
    setSkipped((current) => {
      const next = new Set(current)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })

  // ^ / v: ទៅការស្នើមុន / បន្ទាប់ ហើយលោតទៅមុនវា 1 s ដើម្បីឮបរិបទ
  const step = (kind: Kind, items: CleanupSuggestion[], delta: number) => {
    if (items.length === 0) return
    const now = cursor[kind]
    const next = now < 0 ? (delta > 0 ? 0 : items.length - 1) : (now + delta + items.length) % items.length
    setCursor((current) => ({ ...current, [kind]: next }))
    onSeek?.(Math.max(0, items[next].start - 1))
  }

  if (failed) return <p className="type-hint text-danger">{failed}</p>
  if (answer && !answer.ready) return <p className="type-hint text-text-4">{t('គ្មាន transcript', 'No transcript')}</p>

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <span className="type-label font-semibold">Speech cleanup</span>

      {/* ---- pause ---- */}
      <Card>
        <FoundRow
          label="pauses found"
          count={pauses.length}
          loading={loading && !answer}
          checked={kinds.pause}
          onCheck={(on) => setKinds((current) => ({ ...current, pause: on }))}
          at={cursor.pause}
          onPrev={() => step('pause', pauses, -1)}
          onNext={() => step('pause', pauses, 1)}
        />
        <div className="flex flex-col gap-2">
          <span className="type-hint text-text-3">Pause duration</span>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={PAUSE_MIN}
              max={PAUSE_MAX}
              step={0.1}
              value={pauseDraft}
              onChange={(event) => setPauseDraft(Number(event.target.value))}
              aria-label="Pause duration"
              aria-valuetext={`${pauseDraft.toFixed(1)} ${t('វិនាទី', 'seconds')}`}
              className={`min-w-0 flex-1 cursor-pointer accent-white ${focusRing}`}
            />
            <span className="min-w-14 rounded-field bg-raised-2 px-2.5 py-1.5 text-center type-label tabular-nums">
              {pauseDraft.toFixed(1)}s
            </span>
          </div>
          <span className="type-hint text-text-4">{t('Pause វែងជាងនេះ — ទុកដង្ហើម 0.12 s សងខាង', 'Pauses longer than this — 0.12 s of breath kept on each side')}</span>
        </div>
      </Card>

      {/* ---- filler ---- */}
      <Card>
        <FoundRow
          label="filler words found"
          count={fillers.length}
          loading={loading && !answer}
          checked={kinds.filler && fillers.length > 0}
          disabled={fillers.length === 0}
          onCheck={(on) => setKinds((current) => ({ ...current, filler: on }))}
          at={cursor.filler}
          onPrev={() => step('filler', fillers, -1)}
          onNext={() => step('filler', fillers, 1)}
        />
        <button
          type="button"
          aria-expanded={showFillers}
          disabled={fillers.length === 0}
          onClick={() => setShowFillers((open) => !open)}
          className={`flex min-h-10 cursor-pointer items-center justify-between rounded-field border border-line bg-transparent px-3 type-label text-text hover:bg-raised-2 disabled:cursor-default disabled:text-text-4 disabled:hover:bg-transparent ${focusRing}`}
        >
          {t('មើល filler ទាំងអស់', 'View all fillers')}
          <Caret open={showFillers} />
        </button>
        {showFillers && fillers.length > 0 && (
          <ul className="m-0 flex max-h-[220px] flex-col gap-0.5 overflow-y-auto p-0">
            {fillers.map((item) => (
              <li key={item.start} className="flex list-none items-center gap-2">
                <input
                  type="checkbox"
                  checked={kinds.filler && !skipped.has(item.start)}
                  disabled={!kinds.filler}
                  onChange={() => toggleOne(item.start)}
                  aria-label={`filler ${item.text} ${clockShort(item.start)}`}
                  className={`size-4 cursor-pointer accent-gold ${focusRing}`}
                />
                <button
                  type="button"
                  onClick={() => onSeek?.(Math.max(0, item.start - 1))}
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-field border-0 bg-transparent px-1.5 py-1 text-left type-hint text-text-2 hover:bg-field ${focusRing}`}
                >
                  <span className="w-11 shrink-0 text-text-4 tabular-nums">{clockShort(item.start)}</span>
                  <span className="truncate rounded-[4px] bg-gold-tint px-1.5 text-gold">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="type-hint text-text-4">{t('Whisper ច្រើនតែមិនសរសេរ um / uh — រកឃើញតែអ្វីដែលវាសរសេរ', 'Whisper often leaves out um / uh — only what it wrote is found')}</span>
      </Card>

      {/* ---- Bad takes: AI រកការថតខុស/ថតឡើងវិញ — មិនទាន់មាននៅក្នុង pipeline ---- */}
      <Card row>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="type-body font-semibold">Bad takes</span>
          <span className="type-hint text-text-4">{t('ជំហានបន្ទាប់', 'Next step')}</span>
        </div>
        <button
          type="button"
          disabled
          title={t('រកប្រយោគដែលនិយាយខុស ហើយនិយាយឡើងវិញ — មិនទាន់មាន', 'Find sentences said wrong and said again — not built yet')}
          className="min-h-10 shrink-0 cursor-default rounded-field border-0 bg-raised-2 px-4 type-label font-semibold text-text-4"
        >
          Detect now
        </button>
      </Card>

      <p className="m-0 type-hint text-text-3">
        {loading ? '…' : <>{t('កាត់', 'Cut')} <strong className="text-gold">{seconds.toFixed(1)} s</strong> · {num(picked.length)} {t('កន្លែង', 'places')}</>}
      </p>
      {onApply && (
        <button
          type="button"
          disabled={loading || picked.length === 0}
          onClick={() => onApply(picked)}
          className={`min-h-11 cursor-pointer rounded-[12px] border-0 bg-white type-body font-semibold text-black hover:bg-white/90 disabled:cursor-default disabled:bg-raised-2 disabled:text-text-4 ${focusRing}`}
        >
          {applyLabel}
        </button>
      )}
    </div>
  )
}

function Card({ children, row = false }: { children: ReactNode; row?: boolean }) {
  return (
    <div
      className={`flex rounded-[14px] border border-line p-3.5 ${row ? 'items-center justify-between gap-3' : 'flex-col gap-3'}`}
    >
      {children}
    </div>
  )
}

/** ☑ 9 pauses found      ^ 1/9 v */
function FoundRow({
  label,
  count,
  loading,
  checked,
  disabled = false,
  onCheck,
  at,
  onPrev,
  onNext,
}: {
  label: string
  count: number
  loading: boolean
  checked: boolean
  disabled?: boolean
  onCheck: (on: boolean) => void
  at: number // -1 = មិនទាន់ជ្រើស
  onPrev: () => void
  onNext: () => void
}) {
  const t = useT()
  const none = count === 0
  const navButton = `flex size-7 cursor-pointer items-center justify-center rounded-field border-0 bg-transparent text-text hover:bg-raised-2 disabled:cursor-default disabled:text-text-5 disabled:hover:bg-transparent ${focusRing}`
  return (
    <div className="flex items-center gap-2">
      <label className={`flex min-w-0 flex-1 items-center gap-2.5 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onCheck(event.target.checked)}
          className={`size-5 shrink-0 cursor-pointer accent-white disabled:cursor-default ${focusRing}`}
        />
        <span className="truncate type-body">
          <span className="font-semibold text-ok">{loading ? '…' : count}</span> {label}
        </span>
      </label>
      <button type="button" aria-label={`${label}: ${t('មុន', 'previous')}`} disabled={none} onClick={onPrev} className={navButton}>
        <Caret open />
      </button>
      <span className="min-w-9 text-center type-label text-text-3 tabular-nums">
        {none ? '0/0' : `${at < 0 ? '–' : at + 1}/${count}`}
      </span>
      <button type="button" aria-label={`${label}: ${t('បន្ទាប់', 'next')}`} disabled={none} onClick={onNext} className={navButton}>
        <Caret open={false} />
      </button>
    </div>
  )
}

/** ^ (open) ឬ v */
function Caret({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function clockShort(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}
