/** Badge តូចមូល (design node 4:17). `tone` កំណត់ពណ៌. */
export function Badge({
  label,
  tone = 'accent',
}: {
  label: string
  tone?: 'accent' | 'success' | 'muted' | 'warning'
}) {
  const skin = {
    accent: 'bg-accent-soft text-accent',
    success: 'bg-bg-hover text-success',
    muted: 'bg-bg-hover text-text-secondary',
    warning: 'bg-warning-soft text-warning',
  }[tone]
  return <span className={`rounded-full px-2 py-0.5 text-label ${skin}`}>{label}</span>
}
