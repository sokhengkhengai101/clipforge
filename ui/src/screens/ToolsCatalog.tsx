import { useState } from 'react'
import { Chip } from '../kit/controls'
import { SearchIcon } from '../kit/icons'
import { focusRing } from '../kit/styles'
import { flagsOf } from '../presets'
import { ToolArt } from './ToolArt'
import { useT } from '../i18n'
import { ALL_TOOLS, CATALOG_TABS, type CatalogTab, type Category, type Tool } from './tools'

type Tab = CatalogTab

/** ទំព័រ "ឧបករណ៍ទាំងអស់" — រចនាតាមរូប "More Tools" ដែលអ្នកអភិវឌ្ឍផ្ញើ: tab មានបន្ទាត់
 *  ក្រោម, ប្រអប់ស្វែងរកខាងស្តាំ, និងកាតធំដែលមានរូបលើផ្ទៃពណ៌ gradient.
 *  design/ មិនមានទំព័រនេះទេ ដូច្នេះពណ៌ និងទំហំមកពី tokens ដែលមានស្រាប់.
 *
 *  ឧបករណ៍ទាំងអស់ពិត: ចុច = preset ពិតរបស់វា (ដូច Home); ឧបករណ៍ Phase ក្រោយស្រអាប់.
 *  "ថ្មីៗ" = ឧបករណ៍ដែលអ្នកបានបើកលើកុំព្យូទ័រនេះ (`recentTools.ts`). */
export function ToolsCatalog({
  recent,
  onOpen,
  tab,
  onTab,
}: {
  recent: string[]
  onOpen: (tool: Tool) => void
  tab: Tab // App ជាម្ចាស់ — sidebar (ឧបករណ៍ទាំងអស់ ▾ Clips ...) ក៏ប្តូរវាដែរ
  onTab: (tab: Tab) => void
}) {
  // ចាប់ផ្តើមនៅ "ពេញនិយម" (ដូច "Hot" ក្នុងរូប) — "ថ្មីៗ" ទទេសម្រាប់អ្នកប្រើថ្មី
  const t = useT()
  const [query, setQuery] = useState('')

  const words = query.trim().toLowerCase()
  const shown = words
    ? // ស្វែងរកលើឧបករណ៍ទាំងអស់ មិនមែនតែ tab បច្ចុប្បន្នទេ
      // ស្វែងរកក្នុងភាសាទាំងពីរ — "reframe" ឬ "តាមដានមុខ" រកឃើញដូចគ្នា
      ALL_TOOLS.filter((item) =>
        [item.title.km, item.title.en, item.description.km, item.description.en].join(' ').toLowerCase().includes(words),
      )
    : tab === 'recent'
      ? recent.map((id) => ALL_TOOLS.find((item) => item.id === id)).filter((item) => item !== undefined)
      : ALL_TOOLS.filter((item) => tab === 'popular' || item.categories.includes(tab))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] leading-[1.4] font-bold">{t('ឧបករណ៍ទាំងអស់', 'All tools')}</h1>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" aria-label={t('ប្រភេទឧបករណ៍', 'Tool type')} className="flex flex-wrap gap-7">
          {CATALOG_TABS.map((item) => {
            const here = !words && tab === item.value
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={here}
                onClick={() => {
                  onTab(item.value)
                  setQuery('')
                }}
                className={`relative flex cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0 pt-1 pb-2 text-[16px] ${
                  here ? 'font-bold text-text' : 'text-text-3 hover:text-text-2'
                } ${focusRing}`}
              >
                {item.value === 'popular' && <span aria-hidden="true">🔥</span>}
                {t(item.label)}
                {/* បន្ទាត់ពណ៌ក្រោម tab ដែលជ្រើស (ក្នុងរូប: ពណ៌ស្វាយ; នៅទីនេះ gold របស់ app) */}
                {here && <span className="absolute right-1 bottom-0 left-1 h-[3px] rounded-full bg-gold" />}
              </button>
            )
          })}
        </div>

        <label className="flex min-h-11 w-[340px] max-w-full items-center gap-2.5 rounded-button bg-field px-3.5 text-text-3 focus-within:outline-2 focus-within:outline-solid focus-within:outline-gold">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('ស្វែងរកឧបករណ៍', 'Search tools')}
            aria-label={t('ស្វែងរកឧបករណ៍', 'Search tools')}
            className="min-w-0 flex-1 border-0 bg-transparent type-body-lg text-text outline-none placeholder:text-text-4"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center type-body text-text-3">
          {words
            ? t(`រកមិនឃើញឧបករណ៍ "${query.trim()}"`, `No tool matches "${query.trim()}"`)
            : t('មិនទាន់បានប្រើឧបករណ៍ណាទេ — ឧបករណ៍ដែលអ្នកបើកនឹងលេចនៅទីនេះ', 'No tools used yet — the ones you open show up here')}
        </p>
      ) : (
        // ទទឹងអប្បបរមា 240: ៤ ជួរនៅ 1440, ៣ ជួរនៅ window តូចបំផុត 1100
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
          {shown.map((item) => (
            <CatalogCard key={item.id} tool={item} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** ផ្ទៃពណ៌ខាងក្រោយរូប តាមប្រភេទ — gradient ពីពណ៌ token ទៅផ្ទៃ raised. */
const ART_BACKGROUND: Record<Category, string> = {
  clips: 'radial-gradient(120% 120% at 20% 10%, color-mix(in srgb, var(--color-gold) 34%, transparent), transparent 60%), linear-gradient(160deg, var(--color-raised-2), var(--color-raised))',
  subtitles: 'radial-gradient(120% 120% at 80% 10%, color-mix(in srgb, var(--color-info) 40%, transparent), transparent 60%), linear-gradient(160deg, var(--color-raised-2), var(--color-raised))',
  edit: 'radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--color-ok) 28%, transparent), transparent 60%), linear-gradient(160deg, var(--color-raised-2), var(--color-raised))',
}

/** កាតធំ (ដូចរូប): រូប 150px ក្នុងស៊ុម 6px, ចំណងជើង + ស្លាក AI, ពិពណ៌នា ២ បន្ទាត់. */
function CatalogCard({ tool, onOpen }: { tool: Tool; onOpen: () => void }) {
  const t = useT()
  const ready = tool.phase === null
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onOpen}
      title={
        !ready
          ? `${tool.phase} — ${t('មិនទាន់មាន', 'not available yet')}`
          : tool.opens === 'models'
            ? t('បើកទំព័រ Models', 'Open the Models page')
            : tool.preset
              ? flagsOf(tool.preset) || t('flag លំនាំដើម', 'default flags')
              : undefined
      }
      className={`group flex cursor-pointer flex-col rounded-card border border-line bg-card p-1.5 text-left text-text transition-colors hover:border-raised-4 hover:bg-raised disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-card ${focusRing}`}
    >
      <div
        aria-hidden="true"
        className="relative flex h-[150px] items-center justify-center overflow-hidden rounded-[10px]"
        style={{ background: ART_BACKGROUND[tool.categories[0]] }}
      >
        <div className="transition-transform duration-200 group-hover:scale-110 group-disabled:scale-100">
          <ToolArt id={tool.id} />
        </div>
        {tool.isNew && ready && (
          // ស្លាក "ថ្មី" នៅជ្រុងស្តាំលើ (ដូច "New" ក្នុងរូប)
          // line-height 1.7 + py: ស្រៈ "ី" លើអក្សរខ្មែរត្រូវកាត់ចោលដោយ overflow-hidden បើបន្ទាត់ទាប
          <span className="absolute top-0 right-0 rounded-bl-[10px] bg-gold px-3.5 pt-1 pb-0.5 text-[13px] leading-[1.7] font-bold whitespace-nowrap text-on-gold">
            {t('ថ្មី', 'New')}
          </span>
        )}
        {!ready && (
          <span className="absolute top-2.5 right-2.5">
            <Chip>{tool.phase}</Chip>
          </span>
        )}
      </div>
      <div className="px-2 pt-3 pb-2.5">
        <p className="flex items-center gap-1.5 text-[16px] font-bold">
          {t(tool.title)}
          {tool.badge && (
            <span
              className={`rounded-[4px] px-1.5 text-[11px] font-bold ${
                tool.badge === 'AI' ? 'bg-gold text-on-gold' : 'bg-info text-info-ink'
              }`}
            >
              {tool.badge}
            </span>
          )}
        </p>
        <p className="mt-1 line-clamp-2 text-[13px] leading-[1.6] text-text-3">{t(tool.description)}</p>
      </div>
    </button>
  )
}
