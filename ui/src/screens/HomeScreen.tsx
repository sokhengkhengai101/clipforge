import { useState, type ReactNode } from 'react'
import { Chip, Segmented } from '../kit/controls'
import { ArrowRightIcon, HeadsetIcon, MenuIcon, PlusIcon, UserIcon } from '../kit/icons'
import { WindowControls } from '../kit/TopBar'
import { AppSidebar, type Page } from './AppSidebar'
import { PreviewDialog } from './PreviewDialog'
import { flagsOf } from '../presets'
import { FILTERS, TOOLS, type Category, type Tool } from './tools'
import { focusRing } from '../kit/styles'

/** Screen "Home" (design/screens/Home.html) — ទំព័រដំបូងរបស់ UI ថ្មី.
 *
 *  ចុចឧបករណ៍ = ជ្រើស preset ពិតរបស់វា រួចទៅទំព័រ Projects (drop zone + ប៊ូតុង
 *  Start) — ទំព័រនោះនៅជារចនាចាស់រហូតដល់ជំហាន 2 (Main.html) ប្តូរវា.
 *  អ្វីដែល app មិនមាន (គណនី, Subtitles ខ្មែរ...) នៅលើអេក្រង់ តែប្រាប់ត្រង់ៗ. */
export function HomeScreen({
  page,
  onNavigate,
  onTool,
}: {
  page: Page
  onNavigate: (page: Page) => void
  onTool: (presetId: string) => void
}) {
  const [filter, setFilter] = useState<'popular' | Category>('popular')
  const [preview, setPreview] = useState<'account' | 'later' | null>(null)
  const shown = TOOLS.filter((item) => filter === 'popular' || item.categories.includes(filter))

  return (
    <div className="flex h-full min-h-0 w-full bg-bg font-kantumruy text-text">
      <AppSidebar
        page={page}
        onNavigate={(next) => {
          // "ឧបករណ៍ទាំងអស់" = ទំព័រនេះ ដោយបង្ហាញឧបករណ៍ទាំងអស់
          if (next === 'tools') setFilter('popular')
          onNavigate(next)
        }}
        onQuick={onTool}
        onPreview={() => setPreview('account')}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {/* ជួរខាងលើ: ចន្លោះទទេអូស window បាន (window គ្មាន title bar របស់ Windows).
            វានៅ **ក្រៅ** ផ្ទៃដែល scroll — បើមិនដូច្នោះ ពេល scroll ចុះ ប៊ូតុងបិទ/បង្រួម
            និងតំបន់អូស window រមូរបាត់ (រកឃើញពេលធ្វើឲ្យ window តូច). */}
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-end gap-2.5 px-8 pt-4.5"
        >
          <div data-tauri-drag-region className="flex-1 self-stretch" />
          <IconButton label="ជំនួយ" onClick={() => setPreview('later')}>
            <HeadsetIcon />
          </IconButton>
          <IconButton label="Menu" onClick={() => setPreview('later')}>
            <MenuIcon />
          </IconButton>
          <button
            type="button"
            onClick={() => setPreview('account')}
            className={`inline-flex min-h-10 cursor-pointer items-center gap-2.5 rounded-full border-0 bg-field py-0 pr-3.5 pl-1 type-body font-semibold text-text ${focusRing}`}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-raised-2 text-text-2">
              <UserIcon />
            </span>
            ចូលគណនី
          </button>
          <WindowControls />
        </div>

        {/* មាតិកាដែល scroll; `scrollbar-gutter` ទុកកន្លែង scrollbar ជានិច្ច ដូច្នេះ
            កាតមិនលោតឆ្វេង-ស្តាំពេល scrollbar លេច/បាត់ ពេលប្តូរទំហំ window */}
        <div className="flex min-h-0 flex-1 flex-col gap-6.5 overflow-y-auto px-8 pt-6.5 pb-8 [scrollbar-gutter:stable]">
          <div className="flex flex-wrap gap-5">
            <Hero
              tone="gold"
              title="Auto Clip"
              text="វីដេអូវែង ក្លាយជា clips ខ្លីៗ ជាមួយ subtitles ខ្មែរត្រឹមត្រូវ។"
              action={
                <HeroButton tone="gold" onClick={() => onTool('podcast')}>
                  <PlusIcon /> Import វីដេអូ
                </HeroButton>
              }
              art={<ClipPhones />}
            />
            <Hero
              tone="info"
              title="Subtitle Studio"
              phase="PHASE 2"
              text="Subtitles ខ្មែរ ឬពីរភាសា ខ្មែរ + English សម្រាប់វីដេអូណាមួយ។"
              action={
                // subtitles ខ្មែរ ជា Phase 2 — ប៊ូតុងនៅទីនោះ តែមិនធ្វើពុត
                <HeroButton tone="info" disabled>
                  ចាប់ផ្ដើម <ArrowRightIcon />
                </HeroButton>
              }
              art={<SubtitleCard />}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="ប្រភេទឧបករណ៍"
              shape="pill"
              value={filter}
              onChange={setFilter}
              options={FILTERS}
            />
            <button
              type="button"
              onClick={() => setFilter('popular')}
              className="cursor-pointer border-0 bg-transparent type-body text-text-2 hover:text-text"
            >
              ឧបករណ៍ទាំងអស់ ›
            </button>
          </div>

          <div className="grid grid-cols-4 gap-4">
            {shown.map((item) => (
              <ToolCard
                key={item.id}
                tool={item}
                onOpen={() => item.preset && onTool(item.preset.id)}
              />
            ))}
          </div>
        </div>
      </main>

      {preview && <PreviewDialog kind={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex size-10 cursor-pointer items-center justify-center rounded-button border-0 bg-transparent text-text-2 hover:bg-field ${focusRing}`}
    >
      {children}
    </button>
  )
}

// ---------- hero ----------

/** កាតធំពីរ (radius 18, padding 28, ខ្ពស់ 190). ពណ៌អក្សររងលើផ្ទៃពណ៌ (#2B2B22,
 *  #1A2B44) ប្រើតែម្តងក្នុង design ហើយមិនមានក្នុង TOKENS.md ទេ ដូច្នេះវានៅទីនេះ. */
function Hero({
  tone,
  title,
  text,
  action,
  art,
  phase,
}: {
  tone: 'gold' | 'info'
  title: string
  text: string
  action: ReactNode
  art: ReactNode
  phase?: string
}) {
  const skin = tone === 'gold' ? 'bg-gold text-on-gold' : 'bg-info text-info-ink'
  const sub = tone === 'gold' ? 'text-[#2B2B22]' : 'text-[#1A2B44]'
  return (
    // basis 420 (design: 380): នៅ 1280 hero ពីរនៅក្បែរគ្នាដូច design; នៅ window តូចបំផុត
    // (1100) 380 ទើបតែគ្រប់ ហើយចំណងជើង និងប៊ូតុងរុំអក្សរ — 420 ធ្វើឲ្យវាដាក់ជាន់គ្នាជំនួស
    <section
      className={`flex min-h-[190px] min-w-0 flex-1 basis-[420px] items-center gap-4 rounded-dialog p-7 ${skin}`}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[26px] leading-[1.4] font-bold">{title}</h2>
        <p className={`mt-1.5 mb-4.5 type-body-lg ${sub}`}>{text}</p>
        {/* chip នៅក្បែរប៊ូតុង: វាពន្យល់ថាហេតុអ្វីប៊ូតុងនោះចុចមិនបាន */}
        <div className="flex items-center gap-2.5">
          {action}
          {phase && <Chip>{phase}</Chip>}
        </div>
      </div>
      <div aria-hidden="true" className="shrink-0">
        {art}
      </div>
    </section>
  )
}

/** ប៊ូតុងងងឹតលើ hero (44px, padding 18, អក្សរស 15 ដិត). */
function HeroButton({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: 'gold' | 'info'
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Subtitles ខ្មែរ ជារបស់ Phase 2' : undefined}
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border-0 px-4.5 text-[15px] font-bold whitespace-nowrap text-white outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bg disabled:cursor-default disabled:opacity-50 ${
        tone === 'gold' ? 'bg-bg' : 'bg-info-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** ទូរស័ព្ទបី ដែលមាន caption (Auto Clip hero). */
function ClipPhones() {
  return (
    <div className="flex items-end gap-2">
      <span className="relative h-[102px] w-[58px] rounded-button bg-bg">
        <span className="absolute right-1.5 bottom-3.5 left-1.5 h-2 rounded-[3px] bg-white" />
      </span>
      <span className="relative h-[124px] w-[70px] rounded-[12px] bg-bg">
        <span className="absolute right-5 bottom-4.5 left-2 h-[9px] rounded-[3px] bg-white" />
        <span className="absolute right-2 bottom-4.5 h-[9px] w-2.5 rounded-[3px] bg-gold" />
      </span>
      <span className="relative h-[102px] w-[58px] rounded-button bg-bg">
        <span className="absolute right-1.5 bottom-3.5 left-1.5 h-2 rounded-[3px] bg-white" />
      </span>
    </div>
  )
}

/** កាត subtitle ពីរភាសា (Subtitle Studio hero). */
function SubtitleCard() {
  return (
    <div className="flex w-[150px] flex-col gap-2 rounded-[12px] bg-info-ink p-3.5">
      <span className="h-2.5 w-4/5 rounded-[3px] bg-white" />
      <span className="h-2 w-3/5 rounded-[3px] bg-info" />
      <span className="mt-1.5 h-2.5 w-[70%] rounded-[3px] bg-white" />
      <span className="h-2 w-1/2 rounded-[3px] bg-info" />
    </div>
  )
}

// ---------- tool cards ----------

/** កាតឧបករណ៍ (radius 14, ផ្ទៃ card, ស៊ុម line): រូប 110px លើផ្ទៃ raised + ចំណងជើង.
 *  ឧបករណ៍ដែលមិនទាន់រត់បាន: ស្រអាប់ មិនចុចបាន ហើយមានស្លាក Phase. */
function ToolCard({ tool, onOpen }: { tool: Tool; onOpen: () => void }) {
  const ready = tool.phase === null
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onOpen}
      // tooltip = flag ពិតដែល job នឹងរត់ (description របស់ preset ជាភាសាអង់គ្លេស)
      title={ready && tool.preset ? flagsOf(tool.preset) || 'flag លំនាំដើម' : `${tool.phase} — មិនទាន់មាន`}
      className={`flex cursor-pointer flex-col overflow-hidden rounded-card border border-line bg-card text-left text-text hover:border-raised-3 disabled:cursor-default disabled:opacity-50 disabled:hover:border-line ${focusRing}`}
    >
      <div
        aria-hidden="true"
        className="relative flex h-[110px] items-center justify-center bg-raised"
      >
        <ToolArt id={tool.id} />
        {!ready && (
          <span className="absolute top-2.5 right-2.5">
            <Chip>{tool.phase}</Chip>
          </span>
        )}
      </div>
      <div className="px-3.5 pt-3 pb-4">
        <p className="flex items-center gap-1.5 text-[15px] font-bold">
          {tool.title}
          <span
            className={`rounded-[4px] px-1.5 text-[11px] font-bold ${
              tool.badge === 'AI' ? 'bg-gold text-on-gold' : 'bg-info text-info-ink'
            }`}
          >
            {tool.badge}
          </span>
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.6] text-text-3">{tool.description}</p>
      </div>
    </button>
  )
}

/** រូបភាពក្នុងកាតនីមួយៗ — ទំហំ និងពណ៌ចម្លងពី Home.html. */
function ToolArt({ id }: { id: string }) {
  const bar = (height: number, gold: boolean, key?: number) => (
    <span
      key={key}
      className={`w-1 rounded-[2px] ${gold ? 'bg-gold' : 'bg-text-5'}`}
      style={{ height }}
    />
  )
  switch (id) {
    case 'podcast':
      // រលកសំឡេង: របារកណ្តាលបីពណ៌ gold = ផ្នែកដែល AI ជ្រើស
      return (
        <div className="flex items-center gap-[3px]">
          {[20, 44, 30, 56, 38, 24, 48, 18].map((h, i) => bar(h, i >= 2 && i <= 4, i))}
        </div>
      )
    case 'long':
      return (
        <div className="flex items-center gap-1.5">
          <span className="h-10 w-16 rounded-chip border-2 border-text-5" />
          <span className="text-gold">
            <ArrowRightIcon size={18} />
          </span>
          <span className="h-10 w-[22px] rounded-[4px] bg-gold" />
          <span className="h-10 w-[22px] rounded-[4px] bg-text-5" />
          <span className="h-10 w-[22px] rounded-[4px] bg-text-5" />
        </div>
      )
    case 'subtitles':
      return (
        <span className="self-end pb-5.5 text-[16px] font-bold text-white">
          សួស្ដី <span className="rounded-[4px] bg-gold px-1 text-on-gold">បងប្អូន</span>
        </span>
      )
    case 'reframe':
      return (
        <div className="flex h-[68px] w-[120px] justify-center rounded-chip border-2 border-text-5">
          <span className="flex h-full w-[38px] items-center justify-center border-x-2 border-gold bg-gold-tint">
            <span className="size-3.5 rounded-full bg-text-4" />
          </span>
        </div>
      )
    case 'interview':
      return (
        <div className="flex items-center gap-2.5">
          <span className="rounded-[10px_10px_10px_2px] bg-raised-3 px-2.5 py-1.5 text-[13px] text-white">
            សំណួរ?
          </span>
          <span className="rounded-[10px_10px_2px_10px] bg-gold px-2.5 py-1.5 text-[13px] font-semibold text-on-gold">
            ចម្លើយ
          </span>
        </div>
      )
    case 'silence': {
      const gap = <span className="h-1 w-[26px] rounded-[2px] bg-warn" />
      return (
        <div className="flex items-center gap-[3px]">
          {bar(36, false)}
          {bar(50, false)}
          {gap}
          {bar(42, false)}
          {bar(28, false)}
          {gap}
          {bar(46, false)}
        </div>
      )
    }
    case 'english':
      return (
        <div className="flex flex-col items-center gap-0.5 self-end pb-4.5">
          <span className="text-[14px] font-bold text-white">This changes everything</span>
          <span className="text-[13px] font-semibold text-gold">នេះផ្លាស់ប្ដូរអ្វីៗទាំងអស់</span>
        </div>
      )
    case 'agency':
      return (
        <div className="flex items-center">
          <span className="-mr-[30px] h-16 w-[50px] -rotate-8 rounded-chip bg-raised-3" />
          <span className="-mr-[30px] h-16 w-[50px] rounded-chip bg-raised-4" />
          <span className="h-16 w-[50px] rotate-8 rounded-chip bg-gold" />
        </div>
      )
    default:
      return null
  }
}
