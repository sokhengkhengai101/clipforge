import { useState } from 'react'
import { UserIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { PreviewDialog } from './PreviewDialog'

/** ប៊ូតុង Account នៅ TopBar (Main.html, Processing.html): app គ្មានគណនីទេ ដូច្នេះវាបើក
 *  dialog PREVIEW ដែលពន្យល់ហេតុផល. screen ច្រើនប្រើវា — មិនសរសេរដដែលៗ. */
export function AccountButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label="Account"
        onClick={() => setOpen(true)}
        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-field text-text-2 ${focusRing}`}
      >
        <UserIcon />
      </button>
      {open && <PreviewDialog kind="account" onClose={() => setOpen(false)} />}
    </>
  )
}
