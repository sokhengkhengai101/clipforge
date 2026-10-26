import { IN_TAURI } from './api'

/** ទំហំ UI (Settings › ទូទៅ) — អ្នកអភិវឌ្ឍ: "all element is so big". អេក្រង់ 1920x1080 នៅ Windows scale
 *  125% ទុក 1536x824 ឲ្យ app ខណៈ design ត្រូវបានគូរសម្រាប់ 1280-1440 px.
 *
 *  ប្រើ `setZoom` របស់ Tauri (ដូច Ctrl + / − ក្នុង browser), **មិនមែន** CSS `zoom` លើ <html> ទេ:
 *  webview zoom គណនា viewport ឡើងវិញ ដូច្នេះ `100vh` នៅតែពេញ window; CSS zoom ទុកចន្លោះទទេ 10% ខាងក្រោម.
 *  ឧ. 0.9 = អក្សរ ប៊ូតុង panel ចន្លោះ តូចជាង 10% ហើយ window មាន CSS px ច្រើនជាង 11%.
 *  ក្នុង browser (npm run dev) មិនធ្វើអ្វីទេ — ប្រើ Ctrl + / − របស់ browser. */
export const UI_SCALES = [0.8, 0.9, 1, 1.1] as const
export const DEFAULT_UI_SCALE = 0.9
const KEY = 'kcs.uiScale'

export function readUiScale(): number {
  try {
    const saved = Number(localStorage.getItem(KEY))
    return (UI_SCALES as readonly number[]).includes(saved) ? saved : DEFAULT_UI_SCALE
  } catch {
    return DEFAULT_UI_SCALE // localStorage បិទ: នៅតែដំណើរការ
  }
}

/** ប្តូរ zoom ភ្លាម (មិនរក្សាទុក) — Settings ប្រើវាសម្រាប់ preview មុន OK. */
export function applyUiScale(scale: number): Promise<void> {
  if (!IN_TAURI) return Promise.resolve()
  // import ពេលត្រូវការ: build browser មិនផ្ទុក API របស់ Tauri
  return import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(scale))
    .catch(() => {}) // គ្មាន permission ឬ webview ចាស់: UI នៅ 100% ជំនួសឲ្យខូច
}

export function saveUiScale(scale: number): Promise<void> {
  try {
    localStorage.setItem(KEY, String(scale))
  } catch {
    // មិនអាចរក្សាទុក: នៅតែប្រើក្នុងការបើកនេះ
  }
  return applyUiScale(scale)
}
