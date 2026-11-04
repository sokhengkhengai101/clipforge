/* layout ទាំងអស់របស់ planner — ទំព័រ shots និង timeline របស់ Edit Video ប្រើរួមគ្នា. */

/** ពណ៌ និងឈ្មោះ layout លើ timeline (ReframeResult.html: Fill gold, Split ខៀវ, Fit ប្រផេះ) និង
 *  ហេតុផលដែល planner ជ្រើសវា — ពី reframe.plan_shot: face -> subject -> motion -> centre. */
// en = ឈ្មោះជា English (timeline របស់ Edit Video ពេល app ជា English); label ខ្មែរនៅដដែលសម្រាប់ទំព័រផ្សេង
export const KINDS: Record<string, { label: string; en: string; bar: string; ink: string; why: string }> = {
  single: { label: 'Fill', en: 'Fill', bar: 'bg-gold', ink: 'text-on-gold', why: 'មុខ ឬមនុស្ស/សត្វមួយធំ — crop តាមវា' },
  split: { label: 'Split', en: 'Split', bar: 'bg-info', ink: 'text-info-ink', why: 'មនុស្ស ២ នាក់ក្នុង shot — ម្នាក់មួយផ្ទាំង' },
  three: { label: '៣ នាក់', en: '3 people', bar: 'bg-ok', ink: 'text-on-gold', why: 'មនុស្ស ៣ នាក់ — ផ្ទាំងធំ ១ + តូច ២' },
  four: { label: '៤ នាក់', en: '4 people', bar: 'bg-ok-text', ink: 'text-on-gold', why: 'មនុស្ស ៤ នាក់ — ក្រឡា 2×2' },
  screen1: { label: 'Screen', en: 'Screen', bar: 'bg-warn', ink: 'text-on-gold', why: 'អេក្រង់ចែករំលែក + webcam ១ — slide ខាងលើ មនុស្សខាងក្រោម' },
  screen2: { label: 'Screen', en: 'Screen', bar: 'bg-warn', ink: 'text-on-gold', why: 'អេក្រង់ចែករំលែក + webcam ២ — slide ខាងលើ មនុស្ស ២ នាក់ខាងក្រោម' },
  fit: { label: 'Fit', en: 'Fit', bar: 'bg-text-5', ink: 'text-text', why: 'គ្មានមុខ និងរូបស្ងៀម (slide) — រក្សា frame ទាំងមូលពីលើ blur' },
  custom: { label: 'Custom', en: 'Custom', bar: 'bg-info', ink: 'text-info-ink', why: 'Transform ដោយដៃ — វីដេអូនៅទីតាំង និងទំហំដែលអ្នកដាក់' },
  center: { label: 'កណ្តាល', en: 'Centre', bar: 'bg-raised-3', ink: 'text-text', why: 'គ្មានមុខ គ្មានមនុស្ស — កាត់កណ្តាល (ជម្រើសចុងក្រោយ)' },
}
export const kindOf = (kind: string) => KINDS[kind] ?? KINDS.center
