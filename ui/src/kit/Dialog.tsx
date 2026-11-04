import { useEffect, useId, type ReactNode } from 'react'
import { CloseIcon } from './icons'
import { focusRing } from './styles'
import { useT } from '../i18n'

/** Dialog (SignInModal.html): ផ្ទៃ `card`, radius 18, padding 28, ពីលើ scrim
 *  `rgba(5,7,10,0.74)`, ប៊ូតុងបិទ 40×40 នៅជ្រុងស្តាំខាងលើ.
 *  Escape ឬចុចលើ scrim បិទវា — អ្វីដែលអ្នកប្រើរំពឹងពី modal គ្រប់កន្លែង. */
export function Dialog({
  title,
  onClose,
  width = 440,
  children,
  footer,
}: {
  title: ReactNode
  onClose: () => void
  width?: number // design: 440 (sign-in) ... ធំជាងសម្រាប់ export
  children: ReactNode
  // ជួរខាងក្រោមដែល**មិន**រំកិល (ប៊ូតុងចាប់ផ្តើម) — នៅក្រៅផ្ទៃ scroll ព្រោះ `sticky` ក្នុងផ្ទៃដែលមាន
  // padding អណ្តែតខ្ពស់ពីបាត (Chromium វាស់ពីគែម content)
  footer?: ReactNode
}) {
  const t = useT()
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
        // ប៊ូតុងបិទនៅ**ក្រៅ**ផ្ទៃដែលរំកិល: dialog ខ្ពស់ (AI Reframe ~850 px) រំកិលបាន ប៉ុន្តែ
        // ការរំកិលមិនយកប៊ូតុងបិទចេញពីអេក្រង់ទេ (រកឃើញដោយអ្នកអភិវឌ្ឍ)
        className="relative flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-dialog bg-card font-kantumruy text-text shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
      >
        <button
          type="button"
          aria-label={t('បិទ', 'Close')}
          onClick={onClose}
          className={`absolute top-3 right-3 z-10 inline-flex size-10 cursor-pointer items-center justify-center rounded-button border-0 bg-card text-text-2 hover:bg-field ${focusRing}`}
        >
          <CloseIcon size={14} weight={1.5} />
        </button>
        <div className="flex min-h-0 flex-col gap-4.5 overflow-y-auto p-7">
          <h2 id={titleId} className="pr-10 type-dialog">
            {title}
          </h2>
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-line px-7 py-4">{footer}</div>}
      </div>
    </div>
  )
}
