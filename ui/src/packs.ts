/** Model pack របស់ screen "01 · AI models" (Figma node 11:576).
 *
 *  Pack នីមួយៗគឺ **flag ពិត** ដែល job នឹងរត់ជាមួយ — ដូច preset នៅ Home ដែរ.
 *  `make_clips.py` មាន `--whisper-model` និង `--model` រួចហើយ, ហើយ sidecar
 *  ប្តូរ key ទៅ flag ដោយខ្លួនឯង (`whisper_model` -> `--whisper-model`).
 *
 *  ហេតុអ្វីលេខ `needsVramMb` បែបនេះ: GTX 1060 3GB រត់ `medium` + int8_float32
 *  បានពិត (វាស់រួច 4.0x realtime) តែ `large-v3` មិនចូល 3GB ទេ.
 */
export type Pack = {
  id: 'lite' | 'standard' | 'pro'
  label: string
  sizeGb: number
  needsVramMb: number // 0 = CPU ក៏បាន
  needsLabel: string
  options: { whisper_model: string; model: string }
  features: string[]
  note: string
}

export const PACKS: Pack[] = [
  {
    id: 'lite',
    label: 'Lite',
    sizeGb: 2,
    needsVramMb: 0,
    needsLabel: 'CPU · any PC',
    options: { whisper_model: 'small', model: 'qwen2.5:3b' },
    features: ['whisper small', 'qwen2.5:3b', 'CPU 1.4x realtime'],
    // វាស់រួច: 3b ចំណាយ 2m16s តែ clip មធ្យម 8 វិនាទី ហើយគ្មានមួយដល់ 15s
    note: 'Fast, but clips come out too short — use it to smoke-test the pipeline',
  },
  {
    id: 'standard',
    label: 'Standard',
    sizeGb: 6,
    needsVramMb: 3000,
    needsLabel: 'GPU 3 GB+',
    options: { whisper_model: 'medium', model: 'qwen2.5:7b-instruct' },
    features: ['whisper medium · int8_float32', 'qwen2.5:7b-instruct', 'GPU 4.0x realtime'],
    note: 'What this machine runs today — 8m33s of highlights on a 35-min transcript',
  },
  {
    id: 'pro',
    label: 'Pro',
    sizeGb: 14,
    needsVramMb: 10000,
    needsLabel: 'GPU 10 GB+',
    options: { whisper_model: 'large-v3', model: 'qwen2.5:14b' },
    features: ['whisper large-v3', 'qwen2.5:14b', 'Highest accuracy'],
    note: 'Needs a bigger card — large-v3 does not fit in 3 GB of VRAM',
  },
]

/** pack ណាសមនឹង VRAM ដែលមាន. `null` VRAM = គ្មាន GPU -> មានតែ Lite. */
export function fits(pack: Pack, vramMb: number | null): boolean {
  if (pack.needsVramMb === 0) return true
  return vramMb !== null && vramMb >= pack.needsVramMb
}

/** pack ធំបំផុតដែលនៅតែសម — "BEST FIT" ក្នុង design. */
export function bestFit(vramMb: number | null): Pack {
  const good = PACKS.filter((pack) => fits(pack, vramMb))
  return good[good.length - 1] ?? PACKS[0]
}
