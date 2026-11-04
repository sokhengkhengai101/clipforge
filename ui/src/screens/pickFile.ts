import { IN_TAURI } from '../api'

/** ទម្រង់ដែល FFmpeg អានបាន ហើយមនុស្សច្រើនមាន — ផ្ទាំងជ្រើសបង្ហាញតែទាំងនេះជាដំបូង. */
const MEDIA = ['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'mp3', 'wav', 'm4a']

/** ផ្ទាំងជ្រើស file របស់ Windows ("ជ្រើសឯកសារពីកុំព្យូទ័រ") — ត្រឡប់ path ពេញ ឬ null បើបោះបង់.
 *
 *  ត្រូវការ `tauri-plugin-dialog` (Rust) + `dialog:allow-open` (capabilities). ក្នុង browser
 *  គ្មានវិធីទទួល path ពេញទេ (សុវត្ថិភាព) ដូច្នេះត្រឡប់ `'browser'` ឲ្យ screen សុំ path ជំនួស.
 *  import បែប dynamic ដើម្បីកុំឲ្យ build សម្រាប់ browser ទាញ plugin ចូល. */
export async function pickVideo(): Promise<string | null | 'browser'> {
  if (!IN_TAURI) return 'browser'
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: 'វីដេអូ ឬ audio', extensions: MEDIA },
      { name: 'ឯកសារទាំងអស់', extensions: ['*'] },
    ],
  })
  return typeof picked === 'string' ? picked : null
}

/** ផ្ទាំងជ្រើសរូប (background) — ដូច pickVideo: path ពេញ, null = បោះបង់, 'browser' = គ្មានផ្ទាំង. */
export async function pickImage(): Promise<string | null | 'browser'> {
  if (!IN_TAURI) return 'browser'
  const { open } = await import('@tauri-apps/plugin-dialog')
  const picked = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'រូប', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  return typeof picked === 'string' ? picked : null
}
