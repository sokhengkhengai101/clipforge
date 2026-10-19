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
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
