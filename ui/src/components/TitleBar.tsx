import { IN_TAURI } from '../api'
import windowOne from '../assets/figma/window-1.svg'
import windowTwo from '../assets/figma/window-2.svg'
import windowThree from '../assets/figma/window-3.svg'

/** របារឈ្មោះខាងលើ (design node 5:83).
 *
 *  Window របស់ Tauri គ្មាន decoration ទេ (`decorations: false`) ដូច្នេះរបារនេះ
 *  ជារបារពិត៖ `data-tauri-drag-region` ធ្វើឲ្យអូស window បាន ហើយគ្រាប់ពណ៌ទាំងបី
 *  បិទ / បង្រួម / ពង្រីក. ក្នុង browser វានៅតែជាការតុបតែង.
 */
export function TitleBar({ title }: { title: string }) {
  const act = async (what: 'close' | 'minimize' | 'toggle') => {
    if (!IN_TAURI) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const window = getCurrentWindow()
    if (what === 'close') await window.close()
    else if (what === 'minimize') await window.minimize()
    else await window.toggleMaximize()
  }

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border-default bg-bg-app px-4"
    >
      <Dot icon={windowOne} label="Close" onClick={() => act('close')} />
      <Dot icon={windowTwo} label="Minimize" onClick={() => act('minimize')} />
      <Dot icon={windowThree} label="Maximize" onClick={() => act('toggle')} />
      <p data-tauri-drag-region className="flex-1 text-center text-caption text-text-secondary">
        {title}
      </p>
      <div className="h-3 w-13" />
    </div>
  )
}

function Dot({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}>
      <img src={icon} alt="" width={12} height={12} />
    </button>
  )
}
