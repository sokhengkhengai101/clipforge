import { Badge } from './Badge'
import logoMark from '../assets/figma/logo-mark.svg'
import plus from '../assets/figma/plus.svg'
import navProjects from '../assets/figma/nav-projects.svg'
import navPresets from '../assets/figma/nav-presets.svg'
import navBrandKits from '../assets/figma/nav-brand-kits.svg'
import navBatchQueue from '../assets/figma/nav-batch-queue.svg'
import navModels from '../assets/figma/nav-models.svg'
import navSettings from '../assets/figma/nav-settings.svg'
import statusGpu from '../assets/figma/status-gpu.svg'
import statusOffline from '../assets/figma/status-offline.svg'
import statusModels from '../assets/figma/status-models.svg'

/** `page` = ទំព័រដែល nav នេះបើក; `null` = មិនទាន់សង់ (បង្ហាញ SOON). */
const NAV = [
  { icon: navProjects, label: 'Projects', page: 'projects' },
  { icon: navPresets, label: 'Presets', page: null },
  { icon: navBrandKits, label: 'Brand kits', page: null },
  { icon: navBatchQueue, label: 'Batch queue', page: null },
  { icon: navModels, label: 'Models', page: 'models' },
  { icon: navSettings, label: 'Settings', page: null },
] as const

export type Page = 'projects' | 'models'

/** Sidebar (design node 5:23). ឥឡូវមានតែ Projects ដែលដំណើរការ —
 *  ទំព័រឯទៀតជារបស់ phase ក្រោយ ដូច្នេះវាបង្ហាញជាពណ៌ស្រអាប់. */
export function Sidebar({
  device,
  ffmpeg,
  onNewProject,
  onHome,
  page,
  onPage,
}: {
  device: string
  ffmpeg: boolean
  onNewProject: () => void
  onHome: () => void // 1F: logo ត្រឡប់ទៅ Home ថ្មី
  page: Page
  onPage: (page: Page) => void
}) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-5 border-r border-border-default bg-bg-panel px-4 pt-5 pb-4">
      {/* 1F: screen នេះនៅជារចនាចាស់; logo ជាផ្លូវត្រឡប់ទៅ Home ថ្មី រហូតដល់វាត្រូវប្តូរ */}
      <button type="button" onClick={onHome} title="ទំព័រដើម" className="flex items-center gap-2.5 text-left">
        <div className="flex size-8 items-center justify-center rounded-sm bg-accent">
          <img src={logoMark} alt="" width={18} height={18} />
        </div>
        <div>
          <p className="text-heading text-text-primary">ClipForge</p>
          <p className="text-caption text-text-secondary">Studio · local AI</p>
        </div>
      </button>

      <button
        type="button"
        onClick={onNewProject}
        className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent"
      >
        <img src={plus} alt="" width={16} height={16} />
        New project
      </button>

      <nav className="flex w-full flex-col gap-0.5">
        {NAV.map((item) => {
          const here = item.page !== null && item.page === page
          return (
            <button
              key={item.label}
              type="button"
              disabled={item.page === null}
              onClick={() => item.page && onPage(item.page)}
              title={item.page ? undefined : 'Not built yet'}
              className={`flex h-9 w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left ${
                here ? 'bg-accent-soft' : item.page ? 'hover:bg-bg-hover' : 'opacity-60'
              }`}
            >
              <img src={item.icon} alt="" width={18} height={18} />
              <span
                className={
                  here ? 'text-body-strong text-text-primary' : 'text-body text-text-secondary'
                }
              >
                {item.label}
              </span>
              {item.page === null && (
                <span className="ml-auto text-label text-text-secondary">SOON</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex w-full flex-col gap-2.5 rounded-md border border-border-default bg-bg-card p-3">
        <Row icon={statusGpu} text={device}>
          <Badge label={device.startsWith('cuda') ? 'CUDA' : 'CPU'} tone="success" />
        </Row>
        <Row icon={statusOffline} text="Offline mode">
          <Badge label="LOCAL" />
        </Row>
        <Row icon={statusModels} text={ffmpeg ? 'FFmpeg ready' : 'FFmpeg missing'} />
      </div>
    </aside>
  )
}

function Row({
  icon,
  text,
  children,
}: {
  icon: string
  text: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <img src={icon} alt="" width={16} height={16} />
      <p className="flex-1 truncate text-caption text-text-primary">{text}</p>
      {children}
    </div>
  )
}
