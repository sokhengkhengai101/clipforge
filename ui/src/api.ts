/** ហៅ sidecar. គ្រប់ path ទៅតាម `/api` ដែល Vite proxy បញ្ជូនទៅ port 8765. */

export type Health = {
  ok: boolean
  version: string
  ffmpeg: boolean
  busy: string | null
}

export type Video = {
  name: string
  path: string
  mb: number
}

async function get<T>(path: string): Promise<T> {
  const answer = await fetch(`/api${path}`)
  if (!answer.ok) throw new Error(`${path} -> ${answer.status}`)
  return (await answer.json()) as T
}

export const api = {
  health: () => get<Health>('/health'),
  videos: () => get<Video[]>('/videos'),
}
