/** Badge តូចមូល (design node 4:17). `tone` កំណត់ពណ៌. */
export function Badge({
  label,
  tone = 'accent',
}: {
  label: string
  tone?: 'accent' | 'success' | 'muted'
}) {
  const skin = {
    accent: 'bg-accent-soft text-accent',
    success: 'bg-bg-hover text-success',
    muted: 'bg-bg-hover text-text-secondary',
  }[tone]
  return <span className={`rounded-full px-2 py-0.5 text-label ${skin}`}>{label}</span>
}
