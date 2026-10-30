import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react'
import { khmerNumber } from './screens/khmer'

/** ភាសា app (Settings → ទូទៅ → ភាសា app). មិនមែនភាសា subtitles ក្នុងវីដេអូទេ — នោះជា Phase 2.
 *
 *  អក្សរនីមួយៗសរសេរជាគូនៅកន្លែងដែលវាប្រើ: `t('ទំព័រដើម', 'Home')`. អក្សរខ្មែរនៅមើលឃើញក្នុងកូដ
 *  ដដែល ហើយមិនអាចបាត់ការបកប្រែបានទេ ព្រោះ function តម្រូវឲ្យមានទាំងពីរ (TypeScript ប្រាប់).
 *  ទិន្នន័យដែលនៅក្រៅ component (ឧ. កាតឧបករណ៍ក្នុង tools.ts) ប្រើ `text('...', '...')` ហើយ
 *  `t(tool.title)` យកភាសាដែលត្រូវ. */
export type Lang = 'km' | 'en'
export type Text = { km: string; en: string }

const KEY = 'kcs.lang'
const DEFAULT: Lang = 'km' // អ្នកអភិវឌ្ឍសម្រេច: ខ្មែរ លើកដំបូង

/** ភាសាដែលរក្សាទុក — localStorage អាចបោះ error (private window) ដូច្នេះ try/catch. */
function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'en' || saved === 'km' ? saved : DEFAULT
  } catch {
    return DEFAULT
  }
}

function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // គ្មាន storage: ភាសានៅតែប្តូរសម្រាប់ session នេះ
  }
}

/** អក្សរមួយក្នុងពីរភាសា សម្រាប់ទិន្នន័យក្រៅ component: `text('ឧបករណ៍', 'Tools')`. */
export function text(km: string, en: string): Text {
  return { km, en }
}

type LangState = { lang: Lang; setLang: (lang: Lang) => void }
const LangContext = createContext<LangState>({ lang: DEFAULT, setLang: () => {} })

/** រុំ app ទាំងមូល (main.tsx): រក្សាភាសា ហើយប្រាប់ component ទាំងអស់ពេលវាប្តូរ. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(loadLang)
  useEffect(() => {
    document.documentElement.lang = lang // screen reader និង spell-check ដឹងភាសា
  }, [lang])
  const setLang = (next: Lang) => {
    setLangState(next)
    saveLang(next)
  }
  return createElement(LangContext.Provider, { value: { lang, setLang } }, children)
}

export function useLang(): LangState {
  return useContext(LangContext)
}

/** `const t = useT()` រួច `t('ទំព័រដើម', 'Home')` ឬ `t(tool.title)`. */
export function useT(): (km: string | Text, en?: string) => string {
  const { lang } = useLang()
  return (km, en) => (typeof km === 'string' ? (lang === 'en' ? (en ?? km) : km) : km[lang])
}

/** លេខតាមភាសា app: ខ្មែរ "១២", English "12". `const num = useNum()` រួច `num(cuts.length)`. */
export function useNum(): (value: number | string) => string {
  const { lang } = useLang()
  return (value) => (lang === 'en' ? String(value) : khmerNumber(value))
}
