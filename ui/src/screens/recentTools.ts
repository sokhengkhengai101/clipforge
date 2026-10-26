/** ឧបករណ៍ដែលបានប្រើថ្មីៗ (tab "ថ្មីៗ") — ទុកក្នុង localStorage សម្រាប់អ្នកប្រើម្នាក់នេះ.
 *
 *  localStorage អាចបោះ error (private window, storage ត្រូវបានបិទ) ដូច្នេះរាល់ការអាន/
 *  សរសេរនៅក្នុង try/catch ហើយបើមិនបាន tab នោះគ្រាន់តែទទេ. */
const KEY = 'kcs.recentTools'
const LIMIT = 8

export function loadRecentTools(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** ដាក់ `id` ខាងមុខគេ (ថ្មីជាងគេមុន) ហើយទុកតែ LIMIT ចុងក្រោយ. */
export function rememberTool(id: string): string[] {
  const next = [id, ...loadRecentTools().filter((item) => item !== id)].slice(0, LIMIT)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // គ្មាន storage — ទុកតែក្នុង memory សម្រាប់ session នេះ
  }
  return next
}
