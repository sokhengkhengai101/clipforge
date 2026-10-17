import { useEffect, useState } from 'react'
import { IN_TAURI } from './api'

/** ក្នុង Tauri ការអូស file ផ្តល់ **path ពេញ** (browser ផ្តល់តែឈ្មោះ).
 *
 *  `onDragDropEvent` មកពី `@tauri-apps/api/webview`. យើង import វាបែប
 *  dynamic ដើម្បីឲ្យ build សម្រាប់ browser មិនទាញ module នោះចូល.
 */
export function useFileDrop(onPath: (path: string) => void) {
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (!IN_TAURI) return
    let stop: (() => void) | undefined
    let cancelled = false

    import('@tauri-apps/api/webview').then(({ getCurrentWebview }) => {
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'over') setOver(true)
          else if (event.payload.type === 'leave') setOver(false)
          else if (event.payload.type === 'drop') {
            setOver(false)
            const first = event.payload.paths[0]
            if (first) onPath(first)
          }
        })
        .then((unlisten) => {
          if (cancelled) unlisten()
          else stop = unlisten
        })
    })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [onPath])

  return over
}
