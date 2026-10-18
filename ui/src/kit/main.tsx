import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/kantumruy-pro/400.css'
import '@fontsource/kantumruy-pro/500.css'
import '@fontsource/kantumruy-pro/600.css'
import '@fontsource/kantumruy-pro/700.css'
import '../index.css'
import { Preview } from './Preview'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
