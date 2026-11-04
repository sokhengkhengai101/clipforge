import { ArrowRightIcon } from '../kit/icons'

/** រូបភាពក្នុងកាតនីមួយៗ — ទំហំ និងពណ៌ចម្លងពី Home.html. */
export function ToolArt({ id }: { id: string }) {
  const bar = (height: number, gold: boolean, key?: number) => (
    <span
      key={key}
      className={`w-1 rounded-[2px] ${gold ? 'bg-gold' : 'bg-text-5'}`}
      style={{ height }}
    />
  )
  switch (id) {
    case 'shorts':
      // វីដេអូផ្ដេកមួយ -> clips បញ្ឈរ (clip gold = មួយដែល AI ជ្រើស)
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
    case 'editor':
      // transcript (ពាក្យ + ស្លាក pause) លើ timeline ដែលមាន playhead gold
      return (
        <div className="flex w-[150px] flex-col gap-2">
          <span className="text-[12px] leading-snug font-semibold text-white">
            On <span className="text-gold">John</span> <span className="rounded-[3px] bg-text-5 px-1 text-[10px]">0.46s</span> farm
          </span>
          <span className="relative h-5 rounded-[4px] bg-text-5/60">
            <span className="absolute top-0 left-[38%] h-full w-0.5 bg-gold" />
          </span>
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
    case 'caption':
      // style captions English: ពាក្យសកម្មពណ៌ (ដូច render ពិត)
      return (
        <span className="self-end pb-5.5 text-[17px] font-extrabold tracking-wide text-white uppercase">
          Make it <span className="text-gold">pop</span>
        </span>
      )
    case 'gaming':
      return (
        <div className="flex items-end gap-[3px]">
          {[14, 18, 16, 22, 58, 62, 20, 16, 14].map((h, i) => bar(h, h > 40, i))}
        </div>
      )
    case 'models':
      return (
        <div className="flex items-center gap-2">
          {['Lite', 'Standard', 'Pro'].map((name, i) => (
            <span
              key={name}
              className={`rounded-chip px-2.5 py-1.5 text-[12px] font-bold ${
                i === 1 ? 'bg-gold text-on-gold' : 'bg-raised-3 text-text-2'
              }`}
            >
              {name}
            </span>
          ))}
        </div>
      )
    default:
      return null
  }
}
