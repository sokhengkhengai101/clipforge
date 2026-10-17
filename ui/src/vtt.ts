/** Cue មួយពី file `.vtt` ដែល pipeline សរសេរក្បែរ `.mp4`. */
export type Cue = { start: number; end: number; text: string }

/** អាន `.vtt` ជា cue. ទម្រង់៖ បន្ទាត់ពេលវេលា `00:00:01.000 --> 00:00:02.500`
 *  រួចបន្ទាត់អត្ថបទ រហូតដល់បន្ទាត់ទទេ. */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  let current: Cue | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const times = line.match(/^(\d\d:\d\d:\d\d[.,]\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d[.,]\d\d\d)/)
    if (times) {
      current = { start: toSeconds(times[1]), end: toSeconds(times[2]), text: '' }
      cues.push(current)
    } else if (line === '') {
      current = null
    } else if (current && line !== 'WEBVTT' && !/^\d+$/.test(line)) {
      current.text = current.text ? `${current.text} ${line}` : line
    }
  }
  return cues
}

function toSeconds(stamp: string): number {
  const [hours, minutes, rest] = stamp.replace(',', '.').split(':')
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest)
}
