import { useState, type ReactNode } from 'react'
import { Button, Chip, Progress, Segmented, Select, Switch, TextField } from './controls'
import { Dialog } from './Dialog'
import { UserIcon } from './icons'
import { TopBar } from './TopBar'

/** ទំព័រពិនិត្យ kit (kit.html): component នីមួយៗជាមួយអត្ថបទពី design/screens
 *  ដើម្បីធៀបដាក់ក្បែរ HTML. នេះមិនមែនជា screen របស់ app ទេ. */
export function Preview() {
  const [aspect, setAspect] = useState<'9:16' | '1:1' | '4:5' | '16:9'>('9:16')
  const [lang, setLang] = useState<'km' | 'en'>('km')
  const [filter, setFilter] = useState<'all' | 'running' | 'done'>('all')
  const [shadow, setShadow] = useState(true)
  const [startup, setStartup] = useState(false)
  const [dialog, setDialog] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-bg font-kantumruy text-text">
      <TopBar crumb="Podcast EP12">
        <span className="type-label text-text-3">UI kit · ជំហាន 0</span>
        <button
          type="button"
          aria-label="Account"
          className="inline-flex size-9 items-center justify-center rounded-full border-0 bg-field text-text-2"
        >
          <UserIcon />
        </button>
      </TopBar>

      <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-7 px-8 py-7">
        <Section title="អក្សរ (Kantumruy Pro, bundle)">
          <p className="type-page">ពិនិត្យ Clips</p>
          <p className="type-hero">Clips ៣ រួចរាល់ហើយ!</p>
          <p className="type-dialog">ចូលគណនីដើម្បីប្រើ ៣០ នាទីឥតគិតថ្លៃ</p>
          <p className="type-section">ហេតុអ្វី AI ជ្រើស clip នេះ</p>
          <p className="type-body-lg">ទាញវីដេអូវែងចូល ហើយ AI នឹងរក clips ល្អបំផុតជូនអ្នក។</p>
          <p className="type-body text-text-2">៣ វិនាទីដំបូងចាប់ផ្តើមដោយការអះអាងផ្ទុយពីការគិតទូទៅ</p>
          <p className="type-label text-text-3">កាត់ចាប់ផ្តើម និងបញ្ចប់</p>
          <p className="type-hint text-text-4">មិនចាំបាច់ transcribe ម្តងទៀត · ពិន្ទុជាលេខគំរូ</p>
          {/* ជើងអក្សរ (coeng) ជាន់គ្នា — ពិនិត្យថា shaping ត្រឹមត្រូវ */}
          <p className="type-body-lg">
            ស្ត្រី · ព្រះរាជាណាចក្រកម្ពុជា · ផ្សព្វផ្សាយ · ខ្ញុំសោកស្ដាយបំផុត · ក្រុមការងារដំបូង
          </p>
        </Section>

        <Section title="ពណ៌ (TOKENS.md)">
          <div className="grid grid-cols-6 gap-3">
            {SWATCHES.map(([name, cls]) => (
              <div key={name} className="flex flex-col gap-1.5">
                {/* ring: ឲ្យ `card` មើលឃើញលើ section ដែលមានពណ៌ card ដូចគ្នា */}
                <span className={`h-12 rounded-field ring-1 ring-raised-3 ${cls}`} />
                <span className="type-hint text-text-3">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="ប៊ូតុង">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg">
              Export ៣ Clips
            </Button>
            <Button variant="primary">ចាប់ផ្តើម</Button>
            <Button variant="primary" size="sm">
              Upgrade
            </Button>
            <Button>កែ Subtitles របស់ clip នេះ</Button>
            <Button variant="ghost">បោះបង់</Button>
            <Button variant="primary" disabled>
              កំពុងរង់ចាំ
            </Button>
          </div>
        </Section>

        <Section title="ប្រអប់បញ្ចូល (គ្មានស៊ុម)">
          <div className="flex flex-wrap items-center gap-3">
            <TextField placeholder="https://youtube.com/watch?v=..." className="w-[360px]" />
            <TextField defaultValue="Documents\Khmer Clip Studio\EP12" className="w-[300px]" />
            <Select size="sm" defaultValue="score">
              <option value="score">ពិន្ទុ</option>
              <option value="time">ពេលវេលា</option>
            </Select>
            <Select defaultValue="km">
              <option value="km">ខ្មែរ</option>
              <option value="en">English</option>
            </Select>
          </div>
        </Section>

        <Section title="Segmented">
          <Segmented
            label="ទំហំ (aspect ratio)"
            value={aspect}
            onChange={setAspect}
            options={[
              { value: '9:16', label: '9:16', hint: 'TikTok · Reels' },
              { value: '1:1', label: '1:1' },
              { value: '4:5', label: '4:5', hint: 'Facebook' },
              { value: '16:9', label: '16:9' },
            ]}
          />
          <Segmented
            label="ភាសា app"
            tone="gold"
            value={lang}
            onChange={setLang}
            options={[
              { value: 'km', label: 'ខ្មែរ' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Segmented
            label="តម្រង project"
            shape="pill"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'ទាំងអស់ ៦' },
              { value: 'running', label: 'កំពុងដំណើរការ ១' },
              { value: 'done', label: 'រួចរាល់ ៤' },
            ]}
          />
        </Section>

        <Section title="Switch · Chip · Progress">
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-3 type-body">
              <Switch checked={shadow} onChange={setShadow} label="ស្រមោល" /> ស្រមោល (បើក)
            </label>
            <label className="flex items-center gap-3 type-body">
              <Switch checked={startup} onChange={setStartup} label="បើក app ពេល Windows ចាប់ផ្ដើម" />
              បើក app ពេល Windows ចាប់ផ្ដើម (បិទ — រចនាពី token)
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Chip tone="gold">AI</Chip>
            <Chip tone="info">Agency</Chip>
            <Chip tone="ok">រួចរាល់</Chip>
            <Chip tone="warn">[២៣] នាទីនៅសល់ខែនេះ</Chip>
            <Chip>PHASE 2</Chip>
          </div>
          <div className="flex flex-col gap-2">
            <span className="type-label text-text-3">[៦២]% រួចរាល់ · នៅសល់ប្រហែល [៣] នាទី</span>
            <Progress value={62} label="Overall progress" />
            <Progress value={30} label="Download" thin />
          </div>
        </Section>

        <Section title="Dialog">
          <div>
            <Button variant="primary" onClick={() => setDialog(true)}>
              បើក dialog
            </Button>
          </div>
        </Section>
      </main>

      {dialog && (
        <Dialog title="ចូលគណនីដើម្បីប្រើ ៣០ នាទីឥតគិតថ្លៃ" onClose={() => setDialog(false)}>
          <p className="type-body text-text-3">
            Clips របស់អ្នកនឹងចាប់ផ្ដើមបង្កើតដោយស្វ័យប្រវត្តិ ភ្លាមៗក្រោយពេលចូលរួច។
          </p>
          <Button variant="primary" size="lg">
            បន្តជាមួយ Google
          </Button>
          <Chip tone="neutral">PREVIEW · គ្មាន network</Chip>
        </Dialog>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5 rounded-card bg-card p-5">
      <h2 className="type-section">{title}</h2>
      {children}
    </section>
  )
}

const SWATCHES: [string, string][] = [
  ['bg', 'bg-bg'],
  ['chrome', 'bg-chrome'],
  ['sidebar', 'bg-sidebar'],
  ['card', 'bg-card'],
  ['field', 'bg-field'],
  ['raised', 'bg-raised'],
  ['raised-2', 'bg-raised-2'],
  ['line', 'bg-line'],
  ['gold (accent)', 'bg-gold'],
  ['gold-tint', 'bg-gold-tint'],
  ['info', 'bg-info'],
  ['ok / ok-bg', 'bg-ok'],
  ['warn', 'bg-warn'],
  ['danger', 'bg-danger'],
  ['text', 'bg-text'],
  ['text-2', 'bg-text-2'],
  ['text-3', 'bg-text-3'],
  ['text-4', 'bg-text-4'],
]
