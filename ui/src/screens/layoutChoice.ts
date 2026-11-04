/* Layout ក្នុង Edit Video: ជម្រើស និង flag `--layout` (menu LayoutMenu ប្រើ). */

/** Layout ដែល planner មាន (`--layout` ពិត) + ពីរដែលគូរតែមិនទាន់មាន (Phase 3). */
export type LayoutId = 'fill' | 'fit' | 'split' | 'three' | 'four' | 'screen'
export type LayoutChoice = 'auto' | LayoutId
export const ALL_LAYOUTS: LayoutId[] = ['fill', 'fit', 'split', 'three', 'four', 'screen']

export const ITEMS: { id: LayoutId | 'pip' | 'gameplay'; label: string; soon?: boolean }[] = [
  { id: 'fill', label: 'Fill' },
  { id: 'fit', label: 'Fit' },
  { id: 'split', label: 'Split' },
  { id: 'three', label: 'Three' },
  { id: 'four', label: 'Four' },
  { id: 'pip', label: 'Picture in picture', soon: true },
  { id: 'screen', label: 'ScreenShare' },
  { id: 'gameplay', label: 'Gameplay', soon: true },
]

/** `--layout` ពិតរបស់ជម្រើស: Auto = សំណុំ Global; មួយ = បង្ខំ layout នោះលើវីដេអូទាំងមូល
 *  (screen + fill: shot ដែលមិនមែន screen-share នៅតែតាមមុខ). */
export function layoutFlags(choice: LayoutChoice, allowed: LayoutId[]): string[] {
  if (choice === 'auto') return allowed.length ? allowed : ALL_LAYOUTS
  return choice === 'screen' ? ['screen', 'fill'] : [choice]
}

export function layoutLabel(choice: LayoutChoice): string {
  return choice === 'auto' ? 'Auto' : (ITEMS.find((item) => item.id === choice)?.label ?? choice)
}
