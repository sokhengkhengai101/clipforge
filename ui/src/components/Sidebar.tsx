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

const NAV = [
  { icon: navProjects, label: 'Projects', active: true },
  { icon: navPresets, label: 'Presets', active: false },
  { icon: navBrandKits, label: 'Brand kits', active: false },
  { icon: navBatchQueue, label: 'Batch queue', active: false },
  { icon: navModels, label: 'Models', active: false },
  { icon: navSettings, label: 'Settings', active: false },
]

/** Sidebar (design node 5:23). ឥឡូវមានតែ Projects ដែលដំណើរការ —
 *  ទំព័រឯទៀតជារបស់ phase ក្រោយ ដូច្នេះវាបង្ហាញជាពណ៌ស្រអាប់. */
export function Sidebar({ device, ffmpeg }: { device: string; ffmpeg: boolean }) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-5 border-r border-border-default bg-bg-panel px-4 pt-5 pb-4">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-sm bg-accent">
          <img src={logoMark} alt="" width={18} height={18} />
        </div>
        <div>
          <p className="text-heading text-text-primary">ClipForge</p>
          <p className="text-caption text-text-secondary">Studio · local AI</p>
        </div>
      </div>

      <button
        type="button"
        disabled
        className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-body-strong text-on-accent disabled:opacity-60"
      >
        <img src={plus} alt="" width={16} height={16} />
        New project
      </button>

      <nav className="flex w-full flex-col gap-0.5">
        {NAV.map((item) => (
          <div
            key={item.label}
            className={`flex h-9 items-center gap-2.5 rounded-sm px-3 py-2 ${
              item.active ? 'bg-accent-soft' : ''
            }`}
          >
            <img src={item.icon} alt="" width={18} height={18} />
            <span
              className={
                item.active
                  ? 'text-body-strong text-text-primary'
                  : 'text-body text-text-secondary'
              }
            >
              {item.label}
            </span>
          </div>
        ))}
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
