import { useEffect, useRef, useState } from 'react'
import { IN_TAURI } from './api'

/** ក្នុង Tauri ការអូស file ផ្តល់ **path ពេញ** (browser ផ្តល់តែឈ្មោះ).
 *
 *  `onDragDropEvent` មកពី `@tauri-apps/api/webview`. យើង import វាបែប
 *  dynamic ដើម្បីឲ្យ build សម្រាប់ browser មិនទាញ module នោះចូល.
 *
 *  Hook នេះរស់នៅក្នុង `App` មិនមែនក្នុង drop zone ទេ: Tauri ផ្ញើ drop មកពី
 *  **window ទាំងមូល** ហើយវាធ្លាប់ស្ងាត់នៅគ្រប់ទំព័រលើកលែង Home.
 */
export function useFileDrop(onPath: (path: string) => void) {
  const [over, setOver] = useState(false)

  // `App` render ឡើងវិញរាល់សារ WebSocket របស់ job. បើ `onPath` នៅក្នុង deps,
  // listener ត្រូវលុប-ចុះឈ្មោះឡើងវិញរាល់ដង (ការហៅ IPC មួយទៅ Rust) ហើយ drop
  // ដែលធ្លាក់ចន្លោះនោះបាត់. `ref` រក្សា function ថ្មីបំផុត ដោយមិនប៉ះ listener.
  const latest = useRef(onPath)
  useEffect(() => {
    latest.current = onPath
  })

  useEffect(() => {
    if (!IN_TAURI) return
    let stop: (() => void) | undefined
    let cancelled = false

    import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const kind = event.payload.type
          if (kind === 'enter' || kind === 'over') setOver(true)
          else if (kind === 'leave') setOver(false)
          else if (kind === 'drop') {
            setOver(false)
            const first = event.payload.paths[0]
            if (first) latest.current(first)
          }
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten()
        else stop = unlisten
      })
      // មុននេះគ្មាន catch — បើ listen បរាជ័យ drop គ្រាន់តែឈប់ដំណើរការដោយគ្មានសញ្ញា
      .catch((error) => console.error('file drop listener failed:', error))

    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  return over
}
