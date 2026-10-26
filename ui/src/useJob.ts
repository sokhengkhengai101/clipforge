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
  // ពេល POST /jobs កំពុងរត់ — screen បង្ហាញ "កំពុងចាប់ផ្តើម" មិនមែន status របស់ job មុនទេ
  const [starting, setStarting] = useState(false)
  const socket = useRef<WebSocket | null>(null)

  const listen = useCallback((jobId: string) => {
    // function មានឈ្មោះ ដើម្បីហៅខ្លួនឯងម្តងទៀតពេលភ្ជាប់ឡើងវិញ
    function connect() {
      socket.current?.close()
      const live = new WebSocket(eventsUrl(jobId))
      socket.current = live
      let ended = false // server ផ្ញើ status ចុងក្រោយ (done / failed / cancelled) រួចហើយ
      live.onmessage = (event) => {
        const message = JSON.parse(event.data as string)
        if (message.line) setLog((lines) => [...lines, message.line])
        if (message.status) {
          setStatus(message.status)
          if (message.status.state !== 'running') ended = true
        }
        if (message.error) {
          setError(message.error)
          ended = true
        }
      }
      // socket ដាច់មុន job ចប់ (job វែង ១ ម៉ោង, កុំព្យូទ័រ sleep ...) = កាតនៅ "99%" ជារៀងរហូត
      // (រកឃើញដោយអ្នកអភិវឌ្ឍ). ពេលនោះ: រង់ចាំ 2 វិនាទី, សួរ GET /jobs/{id}, ហើយបើ job នៅរត់
      // ភ្ជាប់ម្តងទៀត. server ផ្ញើ log ទាំងមូលពីដើមវិញ ដូច្នេះយើងសម្អាត log មុន.
      live.onclose = () => {
        if (ended || socket.current !== live) return // ចប់ធម្មតា ឬ job ថ្មីជំនួសហើយ
        window.setTimeout(() => {
          if (socket.current !== live) return
          api
            .job(jobId)
            .then((latest) => {
              if (socket.current !== live) return
              setStatus(latest)
              if (latest.state === 'running') {
                setLog([])
                connect()
              }
            })
            .catch((e: Error) => setError(`ភ្ជាប់ទៅ job មិនបាន: ${e.message}`))
        }, 2000)
      }
    }
    connect()
  }, [])

  const start = useCallback(
    async (options: JobOptions) => {
      setError('')
      setLog([])
      // status ចាស់ (job មុន ដែល `done`) ធ្លាប់នៅលើ screen រហូតដល់ POST ឆ្លើយ ហើយ Processing
      // បង្ហាញ "Clips រួចរាល់ហើយ!" មួយភ្លែត មុន job ថ្មីចាប់ផ្តើម (ឃើញក្នុង test)
      setStatus(null)
      setStarting(true)
      try {
        const job = await api.startJob(options)
        setStatus(job)
        listen(job.id)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setStarting(false)
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

  return { status, log, error, start, cancel, starting, running: status?.state === 'running' }
}
