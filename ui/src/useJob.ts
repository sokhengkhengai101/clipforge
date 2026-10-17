import { useCallback, useEffect, useRef, useState } from 'react'
import { api, eventsUrl, type JobOptions, type JobStatus } from './api'

/** ចាប់ផ្តើម job មួយ រួចស្តាប់ WebSocket ដើម្បីបាន status + log ផ្ទាល់.
 *
 * `useRef` ផ្ទុក socket ឲ្យរស់ឆ្លងការ render ដោយមិនបង្កការ render ថ្មី —
 * ផ្ទុយពី `useState` ដែលការកំណត់វាបង្កឲ្យ component គូរឡើងវិញ.
 */
export function useJob() {
  const [status, setStatus] = useState<JobStatus | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const socket = useRef<WebSocket | null>(null)

  const listen = useCallback((jobId: string) => {
    socket.current?.close()
    const live = new WebSocket(eventsUrl(jobId))
    socket.current = live
    live.onmessage = (event) => {
      const message = JSON.parse(event.data as string)
      if (message.line) setLog((lines) => [...lines, message.line])
      if (message.status) setStatus(message.status)
      if (message.error) setError(message.error)
    }
    live.onerror = () => setError('WebSocket ដាច់')
  }, [])

  const start = useCallback(
    async (options: JobOptions) => {
      setError('')
      setLog([])
      try {
        const job = await api.startJob(options)
        setStatus(job)
        listen(job.id)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [listen],
  )

  const cancel = useCallback(async () => {
    if (!status) return
    try {
      setStatus(await api.cancelJob(status.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [status])

  // បិទ socket ពេល component រលាយ ដើម្បីកុំទុក connection ចោល
  useEffect(() => () => socket.current?.close(), [])

  return { status, log, error, start, cancel, running: status?.state === 'running' }
}
