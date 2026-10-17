import { useCallback, useEffect, useState } from 'react'
import { api, type Env } from '../api'
import { PACKS, bestFit, fits, type Pack } from '../packs'
import { Badge } from './Badge'
import chipGpu from '../assets/figma/status-gpu.svg'
import chipRam from '../assets/figma/chip-ram.svg'
import chipDisk from '../assets/figma/status-models.svg'
import chipOk from '../assets/figma/chip-ok.svg'
import featureYes from '../assets/figma/feature-yes.svg'
import featureDim from '../assets/figma/feature-dim.svg'
import downloadIcon from '../assets/figma/download.svg'

/** Screen "01 · Onboarding · AI models" (Figma node 11:576), ជាទំព័រ **Models**.
 *
 *  Design គូរវាជាជំហានទី ៣ នៃ wizard ៤ ជំហាន (Welcome / Hardware / AI models /
 *  Preferences) ដែល ៣ ជំហានទៀតមិនបានគូរ. អត្ថបទក្នុង card ខ្លួនឯងសរសេរថា
 *  "ផ្លាស់ពេលក្រោយក្នុង Models" — ដូច្នេះយើងសង់វាជាទំព័រនោះតែម្តង, គ្មាន stepper.
 *
 *  អ្វីគ្រប់យ៉ាងនៅទីនេះជារបស់ពិត: chip មកពី `nvidia-smi`, pack ជា flag ដែល job
 *  នឹងរត់, ហើយជួរ Download ប្រាប់ថា model ណាទាញរួច — វាមិនទាញឲ្យទេ (គ្មាន
 *  download manager) ដូច្នេះវាបង្ហាញពាក្យបញ្ជាឲ្យចម្លងជំនួស.
 */
export function Models({
  pack,
  onPack,
}: {
  pack: Pack
  onPack: (pack: Pack) => void
}) {
  const [env, setEnv] = useState<Env | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api
      .env()
      .then(setEnv)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(load, [load])

  const vram = env?.gpu?.vram_mb ?? null
  const best = bestFit(vram)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto p-8">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 rounded-lg border border-border-default bg-bg-panel px-10 py-8">
        <div className="flex flex-col gap-1.5">
          <p className="text-display text-text-primary">Choose your AI model pack</p>
          <p className="font-khmer text-body text-text-secondary">
            ជ្រើសរើស model ដែលសមនឹងកុំព្យូទ័ររបស់អ្នក — ប្ដូរពេលណាក៏បាន។
          </p>
        </div>

        {error && <p className="text-caption text-red-400">{error}</p>}

        <div className="flex flex-wrap gap-2.5">
          <Chip icon={chipGpu} ok={env?.device === 'cuda'}>
            {env?.gpu ? `${env.gpu.name} · ${gb(env.gpu.vram_mb)} VRAM` : 'No NVIDIA GPU · CPU'}
          </Chip>
          <Chip icon={chipRam} ok={(env?.ram_mb ?? 0) >= 8000}>
            {env?.ram_mb ? `${gb(env.ram_mb)} RAM` : 'RAM unknown'}
          </Chip>
          <Chip icon={chipDisk} ok={(env?.disk_free_mb ?? 0) >= 20000}>
            {env?.disk_free_mb ? `${gb(env.disk_free_mb)} free` : 'disk unknown'}
          </Chip>
          <Chip icon={chipDisk} ok={env?.ffmpeg ?? false}>
            {env?.ffmpeg ? 'FFmpeg ready' : 'FFmpeg missing'}
          </Chip>
        </div>

        <div className="flex gap-4">
          {PACKS.map((item) => (
            <PackCard
              key={item.id}
              pack={item}
              chosen={item.id === pack.id}
              best={item.id === best.id}
              usable={fits(item, vram)}
              onPick={() => onPack(item)}
            />
          ))}
        </div>

        <Downloads env={env} pack={pack} onRefresh={load} />

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-strong text-text-primary">
              Use my own API key for highlight detection (optional)
            </p>
            <p className="text-caption text-text-secondary">
              Sends transcript text only — never video. Set{' '}
              <code className="text-text-primary">ANTHROPIC_API_KEY</code> before starting the
              sidecar; it is read at startup, so the page cannot switch it on.
            </p>
          </div>
          <Badge
            label={env?.anthropic_key ? `ON · ${env.anthropic_model}` : 'OFF'}
            tone={env?.anthropic_key ? 'success' : 'muted'}
          />
        </div>

        <footer className="flex items-center gap-2 border-t border-border-default pt-5">
          <p className="text-caption text-text-secondary">
            Every job you start uses{' '}
            <span className="text-text-primary">
              --whisper-model {pack.options.whisper_model} --model {pack.options.model}
            </span>
          </p>
          <div className="flex-1" />
          <button
            onClick={load}
            className="rounded-sm border border-border-default px-4 py-2.5 text-body-strong text-text-primary hover:bg-bg-hover"
          >
            Refresh
          </button>
        </footer>
      </div>
    </div>
  )
}

/** ជួរ Download របស់ design ជា progress bar. យើងគ្មានអ្វីទាញទេ — model មកពី
 *  Ollama និង Hugging Face ដូច្នេះវាប្រាប់ថាអ្វីមានរួច ហើយអ្វីខ្វះត្រូវវាយអ្វី. */
function Downloads({
  env,
  pack,
  onRefresh,
}: {
  env: Env | null
  pack: Pack
  onRefresh: () => void
}) {
  if (!env) return null
  const llmReady = env.ollama.models.some((item) => item.name.startsWith(pack.options.model))
  const whisperReady = env.whisper_cache.includes(pack.options.whisper_model)
  const missingOnnx = env.onnx.filter((item) => !item.present)
  const ready = llmReady && whisperReady && missingOnnx.length === 0 && env.ollama.reachable

  return (
    <div className="flex flex-col gap-2 rounded-md bg-bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <img src={downloadIcon} alt="" width={16} height={16} />
        <p className="text-body-strong text-text-primary">
          {ready ? `${pack.label} pack is on this machine` : `${pack.label} pack needs a download`}
        </p>
        <div className="flex-1" />
        <button onClick={onRefresh} className="text-caption text-text-secondary hover:underline">
          re-check
        </button>
      </div>

      <Need
        ok={whisperReady}
        label={`whisper ${pack.options.whisper_model}`}
        detail={
          whisperReady
            ? `cached (${env.whisper_cache.join(', ')})`
            : 'downloads itself the first time a job transcribes'
        }
      />
      <Need
        ok={env.ollama.reachable && llmReady}
        label={pack.options.model}
        detail={
          !env.ollama.reachable
            ? `Ollama is not answering on ${env.ollama.host} — start it with: ollama serve`
            : llmReady
              ? `pulled (${env.ollama.models.map((m) => `${m.name} ${m.gb} GB`).join(', ')})`
              : `ollama pull ${pack.options.model}`
        }
      />
      {env.onnx.map((item) => (
        <Need
          key={item.name}
          ok={item.present}
          label={`${item.label} model`}
          detail={item.present ? `${item.name} · ${item.mb} MB` : item.fix}
        />
      ))}
    </div>
  )
}

function Need({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <img src={ok ? featureYes : featureDim} alt="" width={14} height={14} className="mt-1" />
      <p className="min-w-0 flex-1 text-caption">
        <span className="text-text-primary">{label}</span>{' '}
        <span className={ok ? 'text-text-secondary' : 'break-all text-warning'}>{detail}</span>
      </p>
    </div>
  )
}

function PackCard({
  pack,
  chosen,
  best,
  usable,
  onPick,
}: {
  pack: Pack
  chosen: boolean
  best: boolean
  usable: boolean
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      disabled={!usable}
      title={usable ? '' : `Needs ${pack.needsLabel}`}
      className={`flex flex-1 flex-col gap-3 rounded-md border p-4 text-left ${
        chosen ? 'border-2 border-accent bg-accent-soft' : 'border-border-default bg-bg-card'
      } ${usable ? 'hover:bg-bg-hover' : 'opacity-40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <span
          className={`size-[18px] shrink-0 rounded-full ${
            chosen ? 'border-5 border-accent' : 'border-[1.5px] border-border-strong'
          }`}
        />
        <span className="text-heading text-text-primary">{pack.label}</span>
        <span className="flex-1" />
        {best && usable && <Badge label="BEST FIT" />}
        {!usable && <Badge label="TOO BIG" tone="muted" />}
      </div>
      <p className="flex items-end gap-1.5">
        <span className="text-title text-text-primary">~{pack.sizeGb} GB</span>
        <span className="text-caption text-text-secondary">{pack.needsLabel}</span>
      </p>
      <span className="flex w-full flex-col gap-1.5">
        {pack.features.map((feature) => (
          <span key={feature} className="flex items-center gap-1.5">
            <img src={chosen ? featureYes : featureDim} alt="" width={14} height={14} />
            <span className="text-caption text-text-primary">{feature}</span>
          </span>
        ))}
      </span>
      <span className="text-caption text-text-secondary">{pack.note}</span>
    </button>
  )
}

function Chip({
  icon,
  ok,
  children,
}: {
  icon: string
  ok: boolean
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-border-default bg-bg-card px-3 py-2">
      <img src={icon} alt="" width={16} height={16} />
      <span className="text-caption text-text-primary">{children}</span>
      {ok && <img src={chipOk} alt="ok" width={14} height={14} />}
    </span>
  )
}

/** 3072 -> "3.0 GB". យើងបង្ហាញ GB ព្រោះ MB មិនជួយអ្នកណាសម្រេចចិត្ត. */
function gb(mb: number): string {
  return `${(mb / 1024).toFixed(1)} GB`
}
