import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Kantumruy Pro ពី node_modules — Vite ចម្លង .woff2 ចូល build ដូច្នេះ app
// desktop បង្ហាញអក្សរខ្មែរបានទោះគ្មាន internet (HANDOFF: កុំពឹង Google Fonts).
import '@fontsource/kantumruy-pro/400.css'
import '@fontsource/kantumruy-pro/500.css'
import '@fontsource/kantumruy-pro/600.css'
import '@fontsource/kantumruy-pro/700.css'
// font របស់ caption ដែល render (config.CAPTION_FONT) — preview ផ្ទាល់លើ Subtitles
import '@fontsource/montserrat/latin-800.css'
// font caption ផ្សេងៗ (ផ្ទាំង Captions › Font): SemiBold, Bold, Black និង italic ពិតរបស់វា
import '@fontsource/montserrat/latin-600.css'
import '@fontsource/montserrat/latin-700.css'
import '@fontsource/montserrat/latin-900.css'
import '@fontsource/montserrat/latin-600-italic.css'
import '@fontsource/montserrat/latin-800-italic.css'
import '@fontsource/montserrat/latin-900-italic.css'
import './index.css'
import App from './App.tsx'
import { LangProvider } from './i18n'
import { applyUiScale, readUiScale } from './uiScale'

// ទំហំ UI ដែលបានរក្សាទុក (Settings › ទូទៅ) — មុន render ដើម្បីកុំឲ្យឃើញ 100% មួយភ្លែត
void applyUiScale(readUiScale())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
)
