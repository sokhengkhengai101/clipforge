import type { SubjectTrack } from './api'

/** ផ្លូវ Manual subject tracking ក្នុង UI — ដូច `reframe.manual_box` ក្នុង Python:
 *  បន្ទាត់ត្រង់រវាងចំណុច, ហើយមុន/ក្រោយផ្លូវ (ប្រធានបទត្រូវបាំង) ទីតាំងនៅនឹងចំណុចចុងៗ.
 *
 *  ឧ. points [[10, 300, 200], [12, 500, 200]] -> ពេល 11 = cx 400; ពេល 15 = cx 500. */
export function pathAt(track: SubjectTrack, time: number): [number, number] {
  const points = track.points
  if (!points.length) return [track.box[0] + track.box[2] / 2, track.box[1] + track.box[3] / 2]
  if (time <= points[0][0]) return [points[0][1], points[0][2]]
  for (let at = 1; at < points.length; at++) {
    const [t1, x1, y1] = points[at]
    if (time <= t1) {
      const [t0, x0, y0] = points[at - 1]
      const k = t1 > t0 ? (time - t0) / (t1 - t0) : 0
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]
    }
  }
  const last = points[points.length - 1]
  return [last[1], last[2]]
}

/** ផ្លូវរបស់ scene ដែលមាន `time` (ឬ null). */
export function trackAt(tracks: SubjectTrack[], time: number): SubjectTrack | null {
  return tracks.find((track) => time >= track.start && time < track.end) ?? null
}
