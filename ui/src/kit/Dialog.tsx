import { useEffect, useId, type ReactNode } from 'react'
import { CloseIcon } from './icons'

/** Dialog (SignInModal.html): ផ្ទៃ `card`, radius 18, padding 28, ពីលើ scrim
 *  `rgba(5,7,10,0.74)`, ប៊ូតុងបិទ 40×40 នៅជ្រុងស្តាំខាងលើ.
 *  Escape ឬចុចលើ scrim បិទវា — អ្វីដែលអ្នកប្រើរំពឹងពី modal គ្រប់កន្លែង. */
export function Dialog({
  title,
  onClose,
  width = 440,
  children,
}: {
  title: ReactNode
  onClose: () => void
  width?: number // design: 440 (sign-in) ... ធំជាងសម្រាប់ export
  children: ReactNode
}) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: width }}
        className="relative flex w-full flex-col gap-4.5 rounded-dialog bg-card p-7 font-kantumruy text-text shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
      >
        <button
          type="button"
          aria-label="បិទ"
          onClick={onClose}
          className="absolute top-3 right-3 inline-flex size-10 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-text-2 outline-none hover:bg-field focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-gold"
        >
          <CloseIcon size={14} weight={1.5} />
        </button>
        <h2 id={titleId} className="pr-10 type-dialog">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
