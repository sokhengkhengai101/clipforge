import { useState, type ReactNode } from 'react'
import { focusRing } from '../kit/styles'
import { MenuButton } from './Menu'
import { useT } from '../i18n'
import { ALL_LAYOUTS, ITEMS, layoutLabel, type LayoutChoice, type LayoutId } from './layoutChoice'

/** Menu Layout (រូប OpusClip): "Global layout settings ›" (layout ដែល AI អាចប្រើ — checkbox) និង
 *  "Current layout" (Auto ឬបង្ខំមួយ; Custom = Transform ដោយដៃ). */
export function LayoutMenu({
  choice,
  allowed,
  custom,
  onChoice,
  onAllowed,
  onCustom,
}: {
  choice: LayoutChoice
  allowed: LayoutId[]
  custom: boolean
  onChoice: (choice: LayoutChoice) => void
  onAllowed: (allowed: LayoutId[]) => void
  onCustom: () => void
}) {
  return (
    <MenuButton label={`Layout: ${custom ? 'Custom' : layoutLabel(choice)}`} icon={<LayoutIcon id={custom ? 'custom' : choice === 'auto' ? 'fill' : choice} />} menuLabel="Layout" width={300}>
      {(close) => (
        <LayoutPanel
          choice={choice}
          allowed={allowed}
          custom={custom}
          onChoice={onChoice}
          onAllowed={onAllowed}
          onCustom={onCustom}
          close={close}
        />
      )}
    </MenuButton>
  )
}

/** មាតិកានៃ menu — mount ពេលបើក ដូច្នេះ submenu Global ចាប់ផ្តើមបិទរាល់ពេល (state នៅក្នុង LayoutMenu
 *  នៅបើកពីលើកមុន ហើយការចុចលើកក្រោយបិទវាវិញ — វាស់). */
function LayoutPanel({
  choice,
  allowed,
  custom,
  onChoice,
  onAllowed,
  onCustom,
  close,
}: {
  choice: LayoutChoice
  allowed: LayoutId[]
  custom: boolean
  onChoice: (choice: LayoutChoice) => void
  onAllowed: (allowed: LayoutId[]) => void
  onCustom: () => void
  close: () => void
}) {
  const t = useT()
  const [globalOpen, setGlobalOpen] = useState(false)
  return (
        <div className="relative">
          <button
            type="button"
            aria-expanded={globalOpen}
            onClick={() => setGlobalOpen((value) => !value)}
            className={`flex min-h-11 w-full cursor-pointer items-center justify-between rounded-field border-0 px-3 type-body font-bold text-text ${
              globalOpen ? 'bg-raised-2' : 'bg-raised hover:bg-raised-2'
            } ${focusRing}`}
          >
            Global layout settings <span aria-hidden="true">›</span>
          </button>

          {/* submenu ខាងស្តាំ: layout ដែល AI អាចជ្រើស (Auto) */}
          {globalOpen && (
            <div
              role="group"
              aria-label="Global layout settings"
              className="absolute top-0 left-full z-30 ml-3 w-[230px] rounded-card border border-line bg-chrome p-2 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
            >
              {ITEMS.map((item) => {
                const on = !item.soon && allowed.includes(item.id as LayoutId)
                return (
                  <Row
                    key={item.id}
                    icon={<LayoutIcon id={item.id} />}
                    label={item.label}
                    checked={on}
                    disabled={item.soon}
                    note={item.soon ? 'Phase 3' : undefined}
                    role="menuitemcheckbox"
                    onClick={() => {
                      const id = item.id as LayoutId
                      const next = on ? allowed.filter((value) => value !== id) : [...allowed, id]
                      if (next.length) onAllowed(ALL_LAYOUTS.filter((value) => next.includes(value))) // យ៉ាងហោចណាស់មួយ
                    }}
                  />
                )
              })}
              <p className="m-0 px-2 pt-1 type-hint text-text-4">{t('Auto: AI ជ្រើសក្នុងចំណោមទាំងនេះ តាម shot នីមួយៗ', 'Auto: the AI picks from these for each shot')}</p>
            </div>
          )}

          <p className="m-0 px-3 pt-3 pb-1 type-hint text-text-4">Current layout</p>
          <Row
            icon={<LayoutIcon id="auto" />}
            label={t('Auto · AI ជ្រើស', 'Auto · AI picks')}
            checked={!custom && choice === 'auto'}
            onClick={() => (onChoice('auto'), close())}
          />
          {ITEMS.map((item) => (
            <Row
              key={item.id}
              icon={<LayoutIcon id={item.id} />}
              label={item.label}
              checked={!custom && choice === item.id}
              disabled={item.soon}
              note={item.soon ? 'Phase 3' : undefined}
              onClick={() => (onChoice(item.id as LayoutId), close())}
            />
          ))}
          <Row icon={<LayoutIcon id="custom" />} label="Custom (Transform)" checked={custom} onClick={() => (onCustom(), close())} />
        </div>
  )
}

function Row({
  icon,
  label,
  checked,
  disabled = false,
  note,
  role = 'menuitemradio',
  onClick,
}: {
  icon: ReactNode
  label: string
  checked: boolean
  disabled?: boolean
  note?: string
  role?: 'menuitemradio' | 'menuitemcheckbox'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      disabled={disabled}
      title={note}
      onClick={onClick}
      className={`flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-field border-0 bg-transparent px-3 text-left type-body text-text hover:bg-raised disabled:cursor-default disabled:text-text-4 disabled:hover:bg-transparent ${focusRing}`}
    >
      <span className={`w-5 shrink-0 ${disabled ? 'text-text-4' : 'text-text-2'}`}>{icon}</span>
      <span className="flex-1 whitespace-nowrap">{label}</span>
      {note && <span className="shrink-0 rounded-[4px] bg-raised-2 px-1.5 text-[10px] font-bold whitespace-nowrap text-text-4">{note}</span>}
      {checked && <span className="text-text">✓</span>}
    </button>
  )
}

/** រូបតូចនៃ layout នីមួយៗ (ដូចរូប OpusClip). */
function LayoutIcon({ id }: { id: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true } as const
  switch (id) {
    case 'fill':
      return (
        <svg {...common}>
          <path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4M2 2l4 4M16 2l-4 4M16 16l-4-4M2 16l4-4" />
        </svg>
      )
    case 'fit':
      return (
        <svg {...common}>
          <path d="M6 2v4H2M12 2v4h4M16 12h-4v4M2 12h4v4M2 2l4 4M16 2l-4 4M16 16l-4-4M2 16l4-4" />
        </svg>
      )
    case 'split':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="14" height="14" rx="2" />
          <path d="M2 9h14" />
        </svg>
      )
    case 'three':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="14" height="14" rx="2" />
          <path d="M2 10h14M9 10v6" />
        </svg>
      )
    case 'four':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="6" height="6" rx="1" />
          <rect x="10" y="2" width="6" height="6" rx="1" />
          <rect x="2" y="10" width="6" height="6" rx="1" />
          <rect x="10" y="10" width="6" height="6" rx="1" />
        </svg>
      )
    case 'pip':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="14" height="14" rx="2" />
          <rect x="9" y="10" width="5" height="4" rx="1" fill="currentColor" />
        </svg>
      )
    case 'screen':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="14" height="11" rx="2" />
          <path d="M2 11a3 3 0 013 3M2 8a6 6 0 016 6" />
        </svg>
      )
    case 'gameplay':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="14" height="14" rx="2" />
          <path d="M2 11h14" />
        </svg>
      )
    case 'custom':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="10" height="10" rx="1" strokeDasharray="2 1.5" />
          <circle cx="4" cy="4" r="1.3" fill="currentColor" />
          <circle cx="14" cy="14" r="1.3" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M9 2l1.8 4.2L15 8l-4.2 1.8L9 14l-1.8-4.2L3 8l4.2-1.8z" />
        </svg>
      )
  }
}
