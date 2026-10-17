import windowOne from '../assets/figma/window-1.svg'
import windowTwo from '../assets/figma/window-2.svg'
import windowThree from '../assets/figma/window-3.svg'

/** របាងឈ្មោះខាងលើ (design node 5:83). នៅក្នុង browser វាជាការតុបតែង —
 *  នៅពេល 1D ខ្ចប់ក្នុង Tauri វាក្លាយជារបារ window ពិត. */
export function TitleBar({ title }: { title: string }) {
  return (
    <div className="flex h-10 w-full items-center gap-2 border-b border-border-default bg-bg-app px-4">
      <img src={windowOne} alt="" width={12} height={12} />
      <img src={windowTwo} alt="" width={12} height={12} />
      <img src={windowThree} alt="" width={12} height={12} />
      <p className="flex-1 text-center text-caption text-text-secondary">{title}</p>
      <div className="h-3 w-13" />
    </div>
  )
}
