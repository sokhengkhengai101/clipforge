/** Class ដែល component ច្រើនប្រើរួមគ្នា. វានៅក្នុង file ដែលមិនមែន component ព្រោះ
 *  file component ដែល export អ្វីផ្សេងពី component បំបែក Fast Refresh (lint
 *  `only-export-components` — មូលហេតុនៃ warning ក្នុង Pipeline.tsx ពីមុន). */

/** Focus ring ពី keyboard (`focus-visible` មិនបង្ហាញពេលចុចដោយ mouse) — HANDOFF:
 *  "Keep keyboard focus visible".
 *  `outline-solid` ចាំបាច់: ក្នុង Tailwind 4 `outline-none` កំណត់ `--tw-outline-style: none`
 *  ហើយ `outline-2` ប្រើ variable នោះ — បើគ្មាន outline-solid ring មិនដែលលេចទេ (វាស់រួច).
 *  វាធ្លាប់ត្រូវសរសេរដដែលៗ ១០ កន្លែង; ឥឡូវកែតែទីនេះ. */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-gold'
