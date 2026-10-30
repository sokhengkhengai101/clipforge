/** Transform video ក្នុង preview — គណិតដូច `pipeline/transform.py` (គ្មាន UI, ងាយពិនិត្យ).
 *
 *  លេខទាំងអស់ជាប្រភាគ: x, y = កណ្តាលប្រអប់ (នៃទទឹង/កម្ពស់ output), scale = ទទឹងប្រអប់ / ទទឹង output,
 *  crop = [x, y, w, h] នៃវីដេអូដើម. ប្រអប់ក្នុង preview ជាប្រភាគនៃផ្ទៃ (stage) ដូចគ្នា.
 *  ឧ. 16:9 ក្នុង 9:16, scale 1, គ្មាន crop -> ទទឹង 100%, កម្ពស់ 0.5625 / 1.778 = 31.6% នៃផ្ទៃ. */
export type Transform = { x: number; y: number; scale: number; crop: [number, number, number, number] }
export type Rect = { left: number; top: number; width: number; height: number } // ប្រភាគនៃផ្ទៃ

export const SCALE_MIN = 0.1
export const SCALE_MAX = 4 // ដូច pipeline.transform.SCALE_RANGE
export const CROP_MIN = 0.05
// ចម្ងាយទាញចូលជា px លើ preview (មិនមែន %): 3% លើ preview ធំ 668 px = 20 px — ប្រអប់ជាប់ ហើយលោត (វាស់)
export const SNAP_PX = 6
const EDGE = 0.005 // crop ជិតគែមវីដេអូ 0.5% = គែមពិត (មិនមែន 0.9999)

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round = (value: number) => Math.round(value * 10000) / 10000

/** សមាមាត្រ (ទទឹង/កម្ពស់) នៃផ្នែកដែល crop. sourceRatio = ទទឹង/កម្ពស់ វីដេអូដើម. */
export function cropRatio(t: Transform, sourceRatio: number): number {
  return (t.crop[2] / t.crop[3]) * sourceRatio
}

/** ប្រអប់វីដេអូ (ផ្នែក crop) លើផ្ទៃ. stageRatio = ទទឹង/កម្ពស់ output (RATIO[aspect]). */
export function boxRect(t: Transform, sourceRatio: number, stageRatio: number): Rect {
  const width = t.scale
  const height = (t.scale * stageRatio) / cropRatio(t, sourceRatio)
  return { left: t.x - width / 2, top: t.y - height / 2, width, height }
}

/** វីដេអូទាំងមូល (មុន crop) លើផ្ទៃ — Crop mode បង្ហាញវាស្រអាប់ ហើយ <video> ពង្រីកដល់វា. */
export function fullRect(t: Transform, sourceRatio: number, stageRatio: number): Rect {
  const box = boxRect(t, sourceRatio, stageRatio)
  const width = box.width / t.crop[2]
  const height = box.height / t.crop[3]
  return { left: box.left - t.crop[0] * width, top: box.top - t.crop[1] * height, width, height }
}

/** Fit = វីដេអូទាំងមូលនៅក្នុងផ្ទៃ; Fill = គ្របផ្ទៃទាំងមូល (ចេញក្រៅ). */
export function fitScale(t: Transform, sourceRatio: number, stageRatio: number): number {
  return clamp(Math.min(1, cropRatio(t, sourceRatio) / stageRatio), SCALE_MIN, SCALE_MAX)
}
export function fillScale(t: Transform, sourceRatio: number, stageRatio: number): number {
  return clamp(Math.max(1, cropRatio(t, sourceRatio) / stageRatio), SCALE_MIN, SCALE_MAX)
}

/** ចាប់ផ្តើម: វីដេអូទាំងមូល Fit នៅកណ្តាល (ដូច layout Fit). */
export function initialTransform(sourceRatio: number, stageRatio: number): Transform {
  const base: Transform = { x: 0.5, y: 0.5, scale: 1, crop: [0, 0, 1, 1] }
  return { ...base, scale: round(fitScale(base, sourceRatio, stageRatio)) }
}

/** ទាញចូលបន្ទាត់ជិតបំផុត (ក្នុង `within`, ប្រភាគ): ឧ. គែមឆ្វេងនៅ -0.005 → 0. half = ពាក់កណ្តាលទំហំប្រអប់. */
function snapAxis(centre: number, half: number, within: number): { value: number; line: number | null } {
  // បេក្ខជន: កណ្តាលប្រអប់ → កណ្តាលផ្ទៃ, គែមប្រអប់ → គែមផ្ទៃ (0 / 1) ទាំងពីខាងក្នុង និងខាងក្រៅ
  const candidates: { value: number; line: number }[] = [
    { value: 0.5, line: 0.5 },
    { value: half, line: 0 }, // គែមដើម (ឆ្វេង/លើ) = 0
    { value: 1 - half, line: 1 }, // គែមចុង (ស្តាំ/ក្រោម) = 1
    { value: -half, line: 0 }, // គែមចុង = 0 (ប្រអប់នៅក្រៅខាងឆ្វេង/លើ)
    { value: 1 + half, line: 1 }, // គែមដើម = 1 (ប្រអប់នៅក្រៅខាងស្តាំ/ក្រោម)
  ]
  let best: { value: number; line: number } | null = null
  for (const candidate of candidates) {
    const distance = Math.abs(centre - candidate.value)
    if (distance < within && (!best || distance < Math.abs(centre - best.value))) best = candidate
  }
  return best ? { value: best.value, line: best.line } : { value: centre, line: null }
}

/** រំកិល: ប្រអប់ថ្មីដោយ (dx, dy) ប្រភាគនៃផ្ទៃ. `box` (ទទឹង/កម្ពស់ប្រអប់) = ទាញកណ្តាល និងគែមចូលកណ្តាល /
 *  គែមផ្ទៃ — សូម្បីតែពេលអូសចេញក្រៅ frame; `within` = ចម្ងាយទាញ (ប្រភាគនៃទទឹង / កម្ពស់ផ្ទៃ);
 *  box null = គ្មានការទាញ (ចុចព្រួញលើ keyboard រំកិលបន្តិចៗ).
 *  snapped = ទីតាំងបន្ទាត់ណែនាំ (0, 0.5, 1) ឬ null. */
export function moveBy(
  t: Transform,
  dx: number,
  dy: number,
  box: { width: number; height: number } | null,
  within: { x: number; y: number } = { x: 0.01, y: 0.01 },
): { t: Transform; snapped: { x: number | null; y: number | null } } {
  let x = clamp(t.x + dx, -1, 2)
  let y = clamp(t.y + dy, -1, 2)
  let snapped: { x: number | null; y: number | null } = { x: null, y: null }
  if (box) {
    const sx = snapAxis(x, box.width / 2, within.x)
    const sy = snapAxis(y, box.height / 2, within.y)
    x = sx.value
    y = sy.value
    snapped = { x: sx.line, y: sy.line }
  }
  return { t: { ...t, x: round(x), y: round(y) }, snapped }
}

/** ពង្រីក/បង្រួមពីជ្រុង: ជ្រុងទល់មុខនៅនឹងកន្លែង (ដូច OpusClip), សមាមាត្រដដែល.
 *  pointer = ទីតាំងមេម៉ៅជាប្រភាគនៃផ្ទៃ; corner = ជ្រុងដែលអូស (0 = ឆ្វេង/លើ, 1 = ស្តាំ/ក្រោម). */
export function scaleFromCorner(
  start: Transform,
  corner: [0 | 1, 0 | 1],
  pointer: [number, number],
  sourceRatio: number,
  stageRatio: number,
): Transform {
  const box = boxRect(start, sourceRatio, stageRatio)
  const anchorX = corner[0] ? box.left : box.left + box.width
  const anchorY = corner[1] ? box.top : box.top + box.height
  // ទទឹងថ្មីពីចម្ងាយផ្ដេក ឬបញ្ឈរ (យកមួយណាធំជាង) — សមាមាត្រមិនប្តូរ
  const perHeight = box.width / box.height
  const width = clamp(Math.max(Math.abs(pointer[0] - anchorX), Math.abs(pointer[1] - anchorY) * perHeight), SCALE_MIN, SCALE_MAX)
  const height = width / perHeight
  const left = corner[0] ? anchorX : anchorX - width
  const top = corner[1] ? anchorY : anchorY - height
  return { ...start, scale: round(width), x: round(left + width / 2), y: round(top + height / 2) }
}

/** ដូច scaleFromCorner ប៉ុន្តែ **គែមដែលកំពុងអូស** ទាញចូលគែមផ្ទៃ (0 / 1) ពេលនៅក្នុង `within`
 *  (ប្រភាគ, ពី SNAP_PX). គែមដែលនៅនឹងកន្លែង (anchor) មិនរាប់ — ដូច្នេះប្រអប់ដែលពេញទទឹងស្រាប់មិនបង្ហាញ
 *  បន្ទាត់រហូតពេលពង្រីក/បង្រួម. snapped = បន្ទាត់ (0 ឬ 1) ដែលគែមប៉ះ ឬ null. */
export function scaleSnapped(
  start: Transform,
  corner: [0 | 1, 0 | 1],
  pointer: [number, number],
  sourceRatio: number,
  stageRatio: number,
  within: { x: number; y: number },
): { t: Transform; snapped: { x: number | null; y: number | null } } {
  const free = scaleFromCorner(start, corner, pointer, sourceRatio, stageRatio)
  const box = boxRect(start, sourceRatio, stageRatio)
  const perHeight = box.width / box.height
  const anchorX = corner[0] ? box.left : box.left + box.width
  const anchorY = corner[1] ? box.top : box.top + box.height
  const now = boxRect(free, sourceRatio, stageRatio)
  const movingX = corner[0] ? now.left + now.width : now.left
  const movingY = corner[1] ? now.top + now.height : now.top
  // បេក្ខជន: គែមដែលអូសប៉ះបន្ទាត់ 0 ឬ 1 -> ទទឹងថ្មីដែលធ្វើឲ្យវាប៉ះពិតប្រាកដ
  let best: { width: number; distance: number; axis: 'x' | 'y'; line: number } | null = null
  for (const line of [0, 1]) {
    const dx = Math.abs(movingX - line)
    const towardX = corner[0] ? line > anchorX : line < anchorX
    if (towardX && dx < within.x && (!best || dx < best.distance)) best = { width: Math.abs(line - anchorX), distance: dx, axis: 'x', line }
    const dy = Math.abs(movingY - line)
    const towardY = corner[1] ? line > anchorY : line < anchorY
    if (towardY && dy < within.y && (!best || dy < best.distance)) best = { width: Math.abs(line - anchorY) * perHeight, distance: dy, axis: 'y', line }
  }
  if (!best || best.width < SCALE_MIN || best.width > SCALE_MAX) return { t: free, snapped: { x: null, y: null } }
  const width = best.width
  const height = width / perHeight
  const left = corner[0] ? anchorX : anchorX - width
  const top = corner[1] ? anchorY : anchorY - height
  // បន្ទាត់ទាំងអស់ដែលគែមដែលអូសប៉ះ (ឧ. ជ្រុងប៉ះទាំងគែមស្តាំ និងគែមក្រោមក្នុងពេលតែមួយ)
  const edgeX = corner[0] ? left + width : left
  const edgeY = corner[1] ? top + height : top
  const near = (value: number) => [0, 1].find((line) => Math.abs(value - line) < 1e-6) ?? null
  return {
    t: { ...start, scale: round(width), x: round(left + width / 2), y: round(top + height / 2) },
    snapped: { x: best.axis === 'x' ? best.line : near(edgeX), y: best.axis === 'y' ? best.line : near(edgeY) },
  }
}

/** Crop: អូសជ្រុងនៃផ្នែក crop លើវីដេអូទាំងមូល (full ថេរតាំងពីចាប់ផ្តើមអូស) — ផ្នែកដែលនៅសល់
 *  នៅនឹងកន្លែងលើផ្ទៃ ដូច្នេះ scale / x / y ត្រូវគណនាឡើងវិញ. */
export function cropFromCorner(
  start: Transform,
  full: Rect,
  corner: [0 | 1, 0 | 1],
  pointer: [number, number],
): Transform {
  const u = clamp((pointer[0] - full.left) / full.width, 0, 1)
  const v = clamp((pointer[1] - full.top) / full.height, 0, 1)
  let [cx, cy, cw, ch] = start.crop
  if (corner[0]) cw = clamp(u - cx, CROP_MIN, 1 - cx)
  else {
    const right = cx + cw
    cx = clamp(u, 0, right - CROP_MIN)
    cw = right - cx
  }
  if (corner[1]) ch = clamp(v - cy, CROP_MIN, 1 - cy)
  else {
    const bottom = cy + ch
    cy = clamp(v, 0, bottom - CROP_MIN)
    ch = bottom - cy
  }
  // ទាញ crop ទៅគែមពិតពេលជិត (អូសដល់គែម = គ្មាន crop នៅខាងនោះ)
  if (cx < EDGE) {
    cw += cx
    cx = 0
  }
  if (cy < EDGE) {
    ch += cy
    cy = 0
  }
  if (cx + cw > 1 - EDGE) cw = 1 - cx
  if (cy + ch > 1 - EDGE) ch = 1 - cy
  const width = cw * full.width
  return {
    crop: [round(cx), round(cy), round(cw), round(ch)],
    scale: round(clamp(width, SCALE_MIN, SCALE_MAX)),
    x: round(full.left + (cx + cw / 2) * full.width),
    y: round(full.top + (cy + ch / 2) * full.height),
  }
}

/** Transform ដែលមើលទៅដូច preview របស់ AI (crop កណ្តាលគ្របផ្ទៃ) — ចាប់ផ្តើមពីវា ពេលអូសវីដេអូក្នុង
 *  AI layout ដូច្នេះរូបមិនលោតពេលប្តូរទៅ Custom. ឧ. 16:9 ក្នុង 9:16 -> crop កណ្តាល 31.6% នៃទទឹង. */
export function coverTransform(sourceRatio: number, stageRatio: number): Transform {
  if (sourceRatio > stageRatio) {
    const cw = round(stageRatio / sourceRatio)
    return { x: 0.5, y: 0.5, scale: 1, crop: [round((1 - cw) / 2), 0, cw, 1] }
  }
  const ch = round(sourceRatio / stageRatio)
  return { x: 0.5, y: 0.5, scale: 1, crop: [0, round((1 - ch) / 2), 1, ch] }
}

/** ជ្រុង និងគែមនៃប្រអប់ crop ក្នុង dialog (ដូច OpusClip: ជ្រុង ៤ + គែម ៤). */
export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type Crop = [number, number, number, number]

/** crop ធំបំផុតនៃសមាមាត្រ `ratio` (ទទឹង/កម្ពស់ ជា pixel) នៅកណ្តាលនៃ crop បច្ចុប្បន្ន ហើយនៅក្នុងវីដេអូ. */
export function cropToRatio(crop: Crop, ratio: number, sourceRatio: number): Crop {
  const [cx, cy, cw, ch] = crop
  const centreX = cx + cw / 2
  const centreY = cy + ch / 2
  // ក្នុងប្រភាគ: w / h = ratio / sourceRatio
  const k = ratio / sourceRatio
  let w = Math.min(1, k)
  let h = w / k
  if (h > 1) {
    h = 1
    w = k
  }
  // យកទំហំដើម បើវាតូចជាង (មិនពង្រីកដោយមិនបាច់)
  const shrink = Math.min(1, Math.max(cw / w, ch / h))
  w *= shrink
  h *= shrink
  const x = clamp(centreX - w / 2, 0, 1 - w)
  const y = clamp(centreY - h / 2, 0, 1 - h)
  return [round(x), round(y), round(w), round(h)]
}

/** អូស handle មួយទៅ (u, v) — ប្រភាគនៃវីដេអូដើម. `ratio` = សមាមាត្រជាប់ (pixel w/h) ឬ null = សេរី.
 *  ជ្រុង/គែមទល់មុខនៅនឹងកន្លែង; សមាមាត្រជាប់ = ពង្រីកផ្នែកម្ខាងទៀតពីកណ្តាលគែម. */
export function dragCrop(start: Crop, handle: CropHandle, u: number, v: number, ratio: number | null, sourceRatio: number): Crop {
  let left = start[0]
  let top = start[1]
  let right = start[0] + start[2]
  let bottom = start[1] + start[3]
  if (handle.includes('w')) left = clamp(u, 0, right - CROP_MIN)
  if (handle.includes('e')) right = clamp(u, left + CROP_MIN, 1)
  if (handle.includes('n')) top = clamp(v, 0, bottom - CROP_MIN)
  if (handle.includes('s')) bottom = clamp(v, top + CROP_MIN, 1)
  if (ratio !== null) {
    const k = ratio / sourceRatio // w / h ជាប្រភាគ
    const horizontal = handle === 'e' || handle === 'w'
    const vertical = handle === 'n' || handle === 's'
    let w = right - left
    let h = bottom - top
    if (vertical) w = h * k
    else if (horizontal) h = w / k
    else if (w / h > k) w = h * k // ជ្រុង: ទំហំតូចជាងគ្រប់គ្រង
    else h = w / k
    // ទំហំថ្មីមិនអាចចេញក្រៅវីដេអូ
    const fit = Math.min(1, 1 / w, 1 / h)
    w *= fit
    h *= fit
    // ជ្រុងទល់មុខនៅនឹងកន្លែង; គែម = ពង្រីកស្មើពីកណ្តាល
    if (handle.includes('w')) left = right - w
    else if (handle.includes('e')) right = left + w
    else {
      const middle = (left + right) / 2
      left = middle - w / 2
      right = middle + w / 2
    }
    if (handle.includes('n')) top = bottom - h
    else if (handle.includes('s')) bottom = top + h
    else {
      const middle = (top + bottom) / 2
      top = middle - h / 2
      bottom = middle + h / 2
    }
    const dx = left < 0 ? -left : right > 1 ? 1 - right : 0
    const dy = top < 0 ? -top : bottom > 1 ? 1 - bottom : 0
    left += dx
    right += dx
    top += dy
    bottom += dy
  }
  return [round(left), round(top), round(right - left), round(bottom - top)]
}
