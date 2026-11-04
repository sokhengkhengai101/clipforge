import { useEffect, useRef, useState } from 'react'
import { clipThumbUrl, sourceFrameUrl, type Project } from '../api'
import { Button, TextField } from '../kit/controls'
import { Dialog } from '../kit/Dialog'
import { PlusIcon, SearchIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { etaLabel, type RunEstimate } from '../eta'
import { clock, khmerNumber, relativeDay } from './khmer'

type Tab = 'all' | 'clips' | 'reframe' | 'unfinished'

/** សកម្មភាពក្នុងម៉ឺនុយ "⋯" របស់ project — App ជាអ្នកធ្វើវា. */
export type ProjectAction = 'review' | 'reframe-result' | 'edit' | 'new-clips' | 'reframe' | 'folder' | 'video' | 'cancel'

/** project ដែល job របស់វាកំពុងរត់ — កាតរបស់វាបង្ហាញ % + ETA (ប៉ាន់ស្មាន, `eta.ts`). */
export type Running = { name: string; estimate: RunEstimate | null }

/** ប្តូរឈ្មោះ និងលុប ត្រូវការ dialog ដូច្នេះទំព័រនេះសួរសិន រួចទើប App ធ្វើ (Promise = រង់ចាំ sidecar). */
type MenuChoice = ProjectAction | 'rename' | 'delete'
type Layout = 'grid' | 'list'

/** ទំព័រ "Projects របស់ខ្ញុំ" — រចនាតាមរូប "My projects" ដែលអ្នកអភិវឌ្ឍផ្ញើ: tab មានបន្ទាត់ក្រោម,
 *  ទំហំដែលប្រើ, ស្វែងរក, ប្តូរ grid/list, កាត "Import វីដេអូថ្មី" មុនគេ រួចកាត project ដែលមាន
 *  រូបពិត. design/ មិនមានទំព័រនេះទេ (Main.html = Import) ដូច្នេះពណ៌មកពី tokens.
 *
 *  អ្វីដែលរូបមាន តែ app យើងមិនមាន: "Free Plan / days left / expired" (app គ្មានគណនី ហើយ
 *  project មិនផុតកំណត់ទេ — វានៅលើកុំព្យូទ័រអ្នក) និង Trash (លុប project ជាការងារមួយផ្សេង). */
export function ProjectsScreen({
  projects,
  outputDir,
  onImport,
  onOpen,
  onAction,
  onRename,
  onDelete,
  running,
}: {
  projects: Project[]
  outputDir: string
  onImport: () => void
  onOpen: (project: Project) => void
  onAction: (project: Project, action: ProjectAction) => void
  onRename: (project: Project, title: string) => Promise<void>
  onDelete: (project: Project) => Promise<void>
  running: Running | null
}) {
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<Layout>('grid')

  const byTab: Record<Tab, Project[]> = {
    all: projects,
    clips: projects.filter((item) => item.clips > 0),
    reframe: projects.filter((item) => item.reframes > 0),
    // មិនទាន់ចប់ = គ្មាន clip និងគ្មាន reframe (ឧ. transcribe រួច តែ job ឈប់)
    unfinished: projects.filter((item) => item.clips === 0 && item.reframes === 0),
  }
  const words = query.trim().toLowerCase()
  const shown = [...byTab[tab]]
    .filter((item) => !words || `${item.title} ${item.name}`.toLowerCase().includes(words))
    .sort((a, b) => b.created - a.created)
  const totalBytes = projects.reduce((sum, item) => sum + item.bytes, 0)
  const withImport = tab === 'all' && !words

  const tabs: { value: Tab; label: string }[] = [
    { value: 'all', label: 'ទាំងអស់' },
    { value: 'clips', label: 'មាន Clips' },
    { value: 'reframe', label: 'Reframe' },
    { value: 'unfinished', label: 'មិនទាន់ចប់' },
  ]

  return (
    <div className="min-w-0 flex-1 overflow-y-auto px-8 pt-6.5 pb-8 [scrollbar-gutter:stable]">
      <div className="flex flex-col gap-5">
        <h1 className="text-[28px] leading-[1.4] font-bold">Projects របស់ខ្ញុំ</h1>

        <div role="tablist" aria-label="ប្រភេទ project" className="flex flex-wrap gap-7 border-b border-line">
          {tabs.map((item) => {
            const here = tab === item.value
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={here}
                onClick={() => setTab(item.value)}
                className={`relative cursor-pointer border-0 bg-transparent px-0 pt-1 pb-3 text-[16px] ${
                  here ? 'font-bold text-text' : 'text-text-3 hover:text-text-2'
                } ${focusRing}`}
              >
                {item.label} ({khmerNumber(byTab[item.value].length)})
                {/* បន្ទាត់ក្រោម tab ដែលជ្រើស ដាក់ពីលើបន្ទាត់ពណ៌ប្រផេះរបស់ជួរ */}
                {here && <span className="absolute right-0 -bottom-px left-0 h-[3px] rounded-full bg-gold" />}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {/* ទំហំដែល project ទាំងអស់ប្រើក្នុង output/ (រូប: "0 GB / 0 GB") — វីដេអូដើមមិនរាប់ទេ */}
          <span className="mr-auto type-label text-text-3" title={outputDir}>
            ប្រើ <span className="font-semibold text-text-2">{size(totalBytes)}</span> ក្នុង folder output
          </span>
          <label className="flex min-h-10 w-[260px] max-w-full items-center gap-2 rounded-button bg-field px-3 text-text-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-gold">
            <SearchIcon size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ស្វែងរក project"
              aria-label="ស្វែងរក project"
              className="min-w-0 flex-1 border-0 bg-transparent type-body text-text outline-none placeholder:text-text-4"
            />
          </label>
          <div role="group" aria-label="របៀបបង្ហាញ" className="flex rounded-button bg-field p-1">
            {(['grid', 'list'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={layout === value}
                aria-label={value === 'grid' ? 'ក្រឡា' : 'បញ្ជី'}
                title={value === 'grid' ? 'ក្រឡា' : 'បញ្ជី'}
                onClick={() => setLayout(value)}
                className={`inline-flex size-8 cursor-pointer items-center justify-center rounded-field border-0 ${
                  layout === value ? 'bg-raised-3 text-text' : 'bg-transparent text-text-3 hover:text-text'
                } ${focusRing}`}
              >
                {value === 'grid' ? <GridGlyph /> : <ListGlyph />}
              </button>
            ))}
          </div>
        </div>

        <ProjectCards
          projects={shown}
          layout={layout}
          withImport={withImport}
          onImport={onImport}
          onOpen={onOpen}
          onAction={onAction}
          onRename={onRename}
          onDelete={onDelete}
          running={running}
        />

        {shown.length === 0 && (
          <p className="py-12 text-center type-body text-text-3">
            {words ? `រកមិនឃើញ project "${query.trim()}"` : 'មិនមាន project ក្នុង tab នេះទេ'}
          </p>
        )}
      </div>
    </div>
  )
}

// ---------- កាត ----------

/** កាត project (ក្រឡា ឬបញ្ជី) + dialog ប្តូរឈ្មោះ/លុប — ប្រើដោយ Projects របស់ខ្ញុំ និងជួរ
 *  "Projects ថ្មីៗ" លើទំព័រដើម. `columns` = ចំនួនជួរថេរ (Home: ៤); គ្មាន = auto-fill. */
export function ProjectCards({
  projects,
  layout = 'grid',
  withImport = false,
  onImport,
  onOpen,
  onAction,
  onRename,
  onDelete,
  running,
  columns,
}: {
  projects: Project[]
  layout?: Layout
  withImport?: boolean
  onImport?: () => void
  onOpen: (project: Project) => void
  onAction: (project: Project, action: ProjectAction) => void
  onRename: (project: Project, title: string) => Promise<void>
  onDelete: (project: Project) => Promise<void>
  running: Running | null
  columns?: number
}) {
  // dialog ដែលកំពុងបើក (ប្តូរឈ្មោះ / លុប) និង project របស់វា
  const [asking, setAsking] = useState<{ kind: 'rename' | 'delete'; project: Project } | null>(null)
  const choose = (project: Project, choice: MenuChoice) => {
    if (choice === 'rename' || choice === 'delete') setAsking({ kind: choice, project })
    else onAction(project, choice)
  }
  const runOf = (project: Project) => (running && running.name === project.name ? running : null)

  return (
    <>
      {layout === 'grid' ? (
        // ទទឹងអប្បបរមា 220: ៤-៥ ជួរនៅ 1440, ៣ ជួរនៅ window តូចបំផុត 1100
        <div
          className="grid gap-x-5 gap-y-6"
          style={{ gridTemplateColumns: columns ? `repeat(${columns}, minmax(0, 1fr))` : 'repeat(auto-fill, minmax(220px, 1fr))' }}
        >
          {withImport && onImport && <ImportCard onClick={onImport} />}
          {projects.map((item) => (
            <ProjectCard
              key={item.name}
              project={item}
              run={runOf(item)}
              onOpen={() => onOpen(item)}
              onAction={(choice) => choose(item, choice)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {withImport && onImport && <ImportRow onClick={onImport} />}
          {projects.map((item) => (
            <ProjectRow
              key={item.name}
              project={item}
              run={runOf(item)}
              onOpen={() => onOpen(item)}
              onAction={(choice) => choose(item, choice)}
            />
          ))}
        </div>
      )}

      {asking?.kind === 'rename' && (
        <RenameDialog
          project={asking.project}
          onClose={() => setAsking(null)}
          onSave={(title) => onRename(asking.project, title)}
        />
      )}
      {asking?.kind === 'delete' && (
        <DeleteDialog
          project={asking.project}
          onClose={() => setAsking(null)}
          onDelete={() => onDelete(asking.project)}
        />
      )}
    </>
  )
}

/** កាតដំបូង: ស៊ុមដាច់ៗ + "Import វីដេអូថ្មី" (រូប: "Upload new video") -> ទំព័រ Import. */
function ImportCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-raised-3 bg-card text-text-2 hover:border-gold hover:text-text ${focusRing}`}
    >
      <span className="scale-150">
        <PlusIcon />
      </span>
      <span className="type-body-lg font-semibold">Import វីដេអូថ្មី</span>
    </button>
  )
}

/** កាត = ប៊ូតុងធំ (បើក project) + ប៊ូតុង "⋯" ក្បែរឈ្មោះ (ដូចរូប). ប៊ូតុងមិនអាចនៅក្នុងប៊ូតុង
 *  ទេ (HTML ហាម) ដូច្នេះវាជាបងប្អូនក្នុង div តែមួយ ហើយ "⋯" ដាក់ពីលើដោយ `absolute`. */
function ProjectCard({
  project,
  run,
  onOpen,
  onAction,
}: {
  project: Project
  run: Running | null
  onOpen: () => void
  onAction: (choice: MenuChoice) => void
}) {
  const openable = Boolean(run) || canOpen(project)
  return (
    // រូប និងឈ្មោះបើក project ទាំងពីរ; "⋯" នៅជួរដដែលនឹងឈ្មោះ (flex) មិនមែន absolute ពីបាតកាត
    // ទេ — ពីមុនវាធ្លាក់នៅចន្លោះឈ្មោះ និងបន្ទាត់ព័ត៌មាន (រកឃើញដោយអ្នកអភិវឌ្ឍ)
    <div className="group flex min-w-0 flex-col gap-2.5">
      <button
        type="button"
        tabIndex={-1} // keyboard ប្រើប៊ូតុងឈ្មោះខាងក្រោម — កុំឲ្យ Tab ឈប់ពីរដងលើ project តែមួយ
        disabled={!openable}
        onClick={onOpen}
        title={run ? 'មើលការដំណើរការ' : openHint(project)}
        className="cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default"
      >
        <Thumb
          project={project}
          run={run}
          className="aspect-video w-full rounded-card group-hover:ring-2 group-hover:ring-raised-4"
        />
      </button>
      <div className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          disabled={!openable}
          onClick={onOpen}
          title={run ? 'មើលការដំណើរការ' : openHint(project)}
          className={`min-w-0 flex-1 cursor-pointer rounded-field border-0 bg-transparent px-0.5 text-left text-text disabled:cursor-default ${focusRing}`}
        >
          <span className="block truncate text-[15px] leading-[1.5] font-bold">{project.title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-text-3">
            {run ? 'កំពុងបង្កើត clips…' : metaLine(project)}
          </span>
        </button>
        <ProjectMenu project={project} running={Boolean(run)} onAction={onAction} />
      </div>
    </div>
  )
}

function ImportRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-card border-2 border-dashed border-raised-3 bg-transparent px-4 text-text-2 hover:border-gold hover:text-text ${focusRing}`}
    >
      <PlusIcon />
      <span className="type-body font-semibold">Import វីដេអូថ្មី</span>
    </button>
  )
}

function ProjectRow({
  project,
  run,
  onOpen,
  onAction,
}: {
  project: Project
  run: Running | null
  onOpen: () => void
  onAction: (choice: MenuChoice) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-card bg-card pr-2 hover:bg-raised">
      <button
        type="button"
        disabled={!run && !canOpen(project)}
        onClick={onOpen}
        title={run ? 'មើលការដំណើរការ' : openHint(project)}
        className={`flex min-w-0 flex-1 cursor-pointer items-center gap-4 rounded-card border-0 bg-transparent p-2 text-left text-text disabled:cursor-default ${focusRing}`}
      >
        <Thumb project={project} run={run} small className="h-[54px] w-24 shrink-0 rounded-field" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{project.title}</span>
        <span className="shrink-0 text-[13px] text-text-3">
          {run ? runLine(run.estimate) : metaLine(project)}
        </span>
      </button>
      <ProjectMenu project={project} running={Boolean(run)} onAction={onAction} />
    </div>
  )
}

/** ម៉ឺនុយ "⋯": បង្ហាញតែសកម្មភាពដែល project នេះធ្វើបានពិត (គ្មានលុប — វាត្រលប់វិញមិនបាន).
 *  បិទពេលចុចក្រៅម៉ឺនុយ ចុច Escape ឬជ្រើសធាតុមួយ. */
function ProjectMenu({
  project,
  running = false,
  onAction,
}: {
  project: Project
  running?: boolean // job កំពុងរត់: បោះបង់បាន, ប្តូរឈ្មោះ/លុប/ចាប់ផ្តើមថ្មី មិនបាន
  onAction: (choice: MenuChoice) => void
}) {
  const [open, setOpen] = useState(false)
  // បើក **ឡើងលើ** ពេលខាងក្រោមគ្មានកន្លែង (ជួរចុងក្រោយ) — វាស់ពេលចុច មិនមែនពេល render
  const [upward, setUpward] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const items: { action: MenuChoice; label: string; show: boolean }[] = running
    ? [
        { action: 'folder', label: 'បើក folder output', show: Boolean(project.folder) },
        { action: 'cancel', label: 'បោះបង់ job', show: true },
      ]
    : [
    { action: 'review', label: 'មើល clips', show: project.clips > 0 },
    { action: 'reframe-result', label: 'លទ្ធផល Reframe', show: project.reframes > 0 },
    { action: 'edit', label: 'Edit Video', show: Boolean(project.video) && project.seconds != null },
    { action: 'new-clips', label: 'បង្កើត clips ថ្មី', show: Boolean(project.video) },
    { action: 'reframe', label: 'Reframe វីដេអូនេះ', show: Boolean(project.video) },
    { action: 'folder', label: 'បើក folder output', show: Boolean(project.folder) },
    { action: 'video', label: 'បង្ហាញវីដេអូដើម', show: Boolean(project.video) },
    // ប្តូរឈ្មោះ និងលុប ត្រូវការ folder ក្នុង output/ (project ពី database ដែលគ្មាន folder លុបបានតែប៉ុណ្ណោះ)
    { action: 'rename', label: 'ប្តូរឈ្មោះ', show: Boolean(project.folder) },
    { action: 'delete', label: 'លុប project', show: true },
  ]
  const shown = items.filter((item) => item.show)
  if (shown.length === 0) return null

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={`ជម្រើសសម្រាប់ ${project.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          const room = window.innerHeight - event.currentTarget.getBoundingClientRect().bottom
          setUpward(room < 300) // ម៉ឺនុយ ៦ ធាតុ ខ្ពស់ ~260 px
          setOpen((value) => !value)
        }}
        // តូច និងស្ងាត់ (ដូចរូប OpusClip): គ្មានផ្ទៃរហូតដល់ hover/បើក, កម្ពស់ស្មើបន្ទាត់ឈ្មោះ (22px)
        className={`inline-flex h-[22px] w-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 text-text-3 hover:bg-raised-2 hover:text-text ${
          open ? 'bg-raised-2 text-text' : 'bg-transparent'
        } ${focusRing}`}
      >
        <DotsGlyph />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={project.title}
          className={`absolute right-0 z-20 flex min-w-[210px] flex-col ${upward ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-[12px] border border-line bg-raised p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]`}
        >
          {shown.map((item) => (
            <div key={item.action} className="contents">
              {/* បន្ទាត់ខណ្ឌ មុនសកម្មភាពដែលប្តូរ project (ប្តូរឈ្មោះ / លុប) */}
              {(item.action === 'rename' || item.action === 'cancel') && (
                <span role="separator" className="mx-2 my-1 h-px bg-raised-3" />
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onAction(item.action)
                }}
                className={`cursor-pointer rounded-field border-0 bg-transparent px-3 py-2 text-left type-body hover:bg-raised-3 ${
                  item.action === 'delete' || item.action === 'cancel' ? 'text-danger' : 'text-text'
                } ${focusRing}`}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** ប្តូរឈ្មោះបង្ហាញ។ ឈ្មោះ folder មិនប្តូរទេ ព្រោះ pipeline ចងវានឹងឈ្មោះ file វីដេអូ. */
function RenameDialog({
  project,
  onClose,
  onSave,
}: {
  project: Project
  onClose: () => void
  onSave: (title: string) => Promise<void>
}) {
  const [title, setTitle] = useState(project.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await onSave(title)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }
  return (
    <Dialog title="ប្តូរឈ្មោះ project" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault() // Enter = រក្សាទុក មិនមែន reload ទំព័រ
          void save()
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="type-label text-text-3">ឈ្មោះថ្មី</span>
          <TextField value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} autoFocus />
        </label>
        <p className="type-hint text-text-4">
          ប្តូរតែឈ្មោះដែលបង្ហាញ — folder <span className="text-text-3">output\{project.name}</span> នៅដដែល
          ព្រោះវាចងនឹងឈ្មោះ file វីដេអូ។ ទុកទទេ = ត្រឡប់ទៅឈ្មោះដើម។
        </p>
        {error && <p className="type-label text-danger">{error}</p>}
        <div className="flex justify-end gap-2.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            បោះបង់
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'កំពុងរក្សាទុក...' : 'រក្សាទុក'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

/** បញ្ជាក់មុនលុប: ប្រាប់ឲ្យច្បាស់ថាអ្វីបាត់ អ្វីនៅ (វីដេអូដើម) និងថា folder ទៅ Recycle Bin. */
function DeleteDialog({
  project,
  onClose,
  onDelete,
}: {
  project: Project
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }
  return (
    <Dialog title="លុប project នេះ?" onClose={onClose}>
      <p className="type-body-lg font-semibold break-words">{project.title}</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 type-body text-text-2">
        {project.folder ? (
          <li>
            folder <span className="text-text">output\{project.name}</span> ({size(project.bytes)}) — clips, reframe,
            audio និង transcript — ទៅ <span className="font-semibold text-text">Recycle Bin</span> (យកមកវិញបាន)
          </li>
        ) : (
          <li>project នេះគ្មាន folder ក្នុង output ទេ — លុបតែពីបញ្ជីប៉ុណ្ណោះ</li>
        )}
        <li>ប្រវត្តិ job របស់វាបាត់ ({khmerNumber(project.jobs)} ដង)</li>
        <li className="text-ok-text">វីដេអូដើមរបស់អ្នកមិនត្រូវបានប៉ះទេ</li>
      </ul>
      {error && <p className="type-label text-danger">{error}</p>}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose} autoFocus>
          បោះបង់
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {busy ? 'កំពុងលុប...' : 'លុប project'}
        </Button>
      </div>
    </Dialog>
  )
}

function DotsGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="13" cy="8" r="1.25" />
    </svg>
  )
}

/** រូបពិត: clip ទី ១ (thumb ដែល sidecar រក្សាទុក) ឬ frame ពីវីដេអូដើម; ស្លាកលើរូប. */
function Thumb({
  project,
  run = null,
  className,
  small,
}: {
  project: Project
  run?: Running | null
  className: string
  small?: boolean
}) {
  const src =
    project.clips > 0
      ? clipThumbUrl(project.name, 1)
      : project.video
        ? sourceFrameUrl(project.video, project.seconds ? Math.min(60, project.seconds * 0.1) : 5)
        : null
  const badge = run ? { text: 'កំពុងដំណើរការ', tone: 'bg-gold text-on-gold' } : stateBadge(project)
  return (
    <span className={`relative block overflow-hidden bg-raised-2 ${className}`}>
      {src ? (
        // clip ជាបញ្ឈរ (9:16) -> object-contain លើផ្ទៃងងឹត ដូចកាត "Black Rhino" ក្នុងរូប
        <img
          src={src}
          alt=""
          loading="lazy"
          className={`size-full ${project.clips > 0 ? 'object-contain' : 'object-cover'}`}
        />
      ) : (
        <span className="flex size-full items-center justify-center type-hint text-text-4">គ្មានរូប</span>
      )}
      {run && !small && (
        // ស្លាកវឌ្ឍនភាពកណ្តាលរូប (រូប OpusClip: "8% (ETA 3m)") + របារនៅបាត — % ប៉ាន់ស្មាន (eta.ts)
        <>
          <span className="absolute inset-0 bg-black/45" />
          <span
            className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5 rounded-[10px] border border-ok/50 bg-black/80 px-3.5 py-2 text-center whitespace-nowrap"
            title="ប៉ាន់ស្មានពីល្បឿនដែលវាស់លើកុំព្យូទ័រនេះ — អាចខុសពីការពិតច្រើននាទី"
          >
            <span className="text-[14px] font-bold text-ok-text tabular-nums">{runLine(run.estimate)}</span>
            {/* ពីល្បឿនពិត = pipeline ប្រាប់វឌ្ឍនភាពជំហាននេះ; ប៉ាន់ស្មាន = ពីល្បឿនដែលវាស់ពីមុន */}
            <span className="text-[11px] text-text-3">{run.estimate?.measured ? 'ពីល្បឿនពិត' : 'ប៉ាន់ស្មាន'}</span>
          </span>
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <span className="block h-full bg-ok transition-[width] duration-700" style={{ width: `${run.estimate?.percent ?? 0}%` }} />
          </span>
        </>
      )}
      {run && small && <span className="absolute inset-x-0 bottom-0 h-1 bg-ok" style={{ width: `${run.estimate?.percent ?? 0}%` }} />}
      {!run && !small && project.seconds !== null && (
        <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/70 px-1.5 text-[12px] font-semibold text-white tabular-nums">
          {clock(project.seconds)}
        </span>
      )}
      {!small && badge && (
        <span className={`absolute top-2 right-2 rounded-[6px] px-2 py-0.5 text-[12px] font-bold ${badge.tone}`}>
          {badge.text}
        </span>
      )}
    </span>
  )
}

// ---------- ជំនួយ ----------

/** "38% · ~៩ នាទី" ឬ "កំពុងចាប់ផ្តើម…" មុន status ដំបូងមកដល់. */
function runLine(estimate: RunEstimate | null): string {
  if (!estimate) return 'កំពុងចាប់ផ្តើម…'
  return `${khmerNumber(estimate.percent)}% · ${etaLabel(estimate.remaining, khmerNumber)}`
}

/** ស្លាកលើរូប (រូប: "Free Plan" / "Project expired") — នៅទីនេះជាស្ថានភាពពិតរបស់ project. */
function stateBadge(project: Project): { text: string; tone: string } | null {
  if (project.last_state === 'running') return { text: 'កំពុងដំណើរការ', tone: 'bg-gold text-on-gold' }
  const stopped = project.last_state === 'failed' || project.last_state === 'interrupted'
  if (project.clips === 0 && project.reframes === 0 && stopped) return { text: 'បានឈប់', tone: 'bg-warn text-bg' }
  if (project.clips > 0) return { text: `${khmerNumber(project.clips)} clips`, tone: 'bg-black/70 text-white' }
  if (project.reframes > 0) return { text: 'Reframe', tone: 'bg-black/70 text-white' }
  return null
}

function metaLine(project: Project): string {
  const parts = []
  if (project.clips > 0) parts.push(`${khmerNumber(project.clips)} clips`)
  if (project.reframes > 0) parts.push(`${khmerNumber(project.reframes)} reframe`)
  parts.push(size(project.bytes), relativeDay(project.created))
  return parts.join(' · ')
}

/** បើកបានពេល: មាន clip (Review), មាន reframe (Result), ឬដឹង path វីដេអូ (Import ដើម្បីចាប់ផ្តើម). */
function canOpen(project: Project): boolean {
  return project.clips > 0 || project.reframes > 0 || Boolean(project.video)
}

function openHint(project: Project): string {
  if (project.clips > 0) return 'បើក Review'
  if (project.reframes > 0) return 'បើកលទ្ធផល Reframe'
  if (project.video) return 'បើក Import ដើម្បីបង្កើត clips'
  return 'មិនដឹង path វីដេអូដើម'
}

/** 3543700000 -> "3.5 GB", 157900000 -> "158 MB". */
function size(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`
}

function GridGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  )
}

function ListGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />
    </svg>
  )
}
