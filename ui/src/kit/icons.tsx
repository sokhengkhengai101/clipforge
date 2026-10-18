/** Icon ពី design/screens/*.html — path ចម្លងដូចបេះបិទ មិនគូរថ្មីទេ.
 *  ពណ៌មកពី `currentColor` (ពណ៌អក្សររបស់ធាតុមេ) ដូច្នេះ hover ប្តូរពណ៌បាន
 *  ហើយ design ប្រើ #D4D8DF (= `text-text-2`) សម្រាប់ស្ទើរតែគ្រប់ icon. */

/** ត្រីកោណ "play" ក្នុងការ៉េលឿងរបស់ logo (Review.html, SignInModal.html). */
export function PlayMark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.5L12 7L3 12.5Z" fill="currentColor" />
    </svg>
  )
}

/** Window controls: បន្ទាត់ 12px, stroke 1.25 (Review.html). */
export function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M1 6h10" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

export function MaximizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="9"
        height="9"
        rx="1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  )
}

/** X: window control ប្រើ 12px / 1.25; ប៊ូតុងបិទ dialog ប្រើ 14px / 1.5 មូល (SignInModal.html). */
export function CloseIcon({ size = 12, weight = 1.25 }: { size?: number; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M1.5 1.5l9 9M10.5 1.5l-9 9"
        stroke="currentColor"
        strokeWidth={weight}
        strokeLinecap={weight > 1.25 ? 'round' : undefined}
      />
    </svg>
  )
}

/** រូបមនុស្សក្នុងប៊ូតុង Account (Review.html top bar). */
export function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  )
}
