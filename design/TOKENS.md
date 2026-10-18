# Design tokens

## Colors (dark theme only)

| Token | Hex | Use |
|---|---|---|
| bg | `#101318` | App background |
| chrome | `#0B0D11` | Top bar, footer bars, preview stage |
| sidebar | `#0E1116` | Side panels, nav |
| card | `#171B22` | Cards, dialogs, sections |
| field | `#1F2430` | Inputs, selects, secondary buttons, selected nav item |
| raised | `#232936` | Unselected segmented buttons, chips |
| raised-2 | `#2A303C` | Thumbnails, hover |
| line | `#262C38` | Panel dividers (not on form controls) |
| text | `#F3F4F6` | Primary text |
| text-2 | `#C3C8D1` / `#D4D8DF` | Secondary text |
| text-3 | `#A9B0BC` | Labels, metadata |
| text-4 | `#8A93A3` | Hints |
| accent | `#FFD23F` | Primary buttons, selection, highlights (text on accent: `#101318`) |
| accent-tint | `#2A2A1C` | Selected background with accent outline |
| info | `#8EC5FF` | Split layout, secondary category |
| success | `#4ADE80` on `#1E3A2B` | Done states |
| warning | `#FB923C`, text `#FDBA74`, bg `#1F1712` | Low minutes, uncertain words |
| danger | `#F05252` | New-feature dots, safe-zone overlay |
| selected-segment | `#F3F4F6` bg, `#101318` text | Selected option in segmented controls |

## Type

- Family: Kantumruy Pro (400, 500, 600, 700). Line height 1.6-1.8 for Khmer body text, 1.4-1.5 for headings.
- Sizes: page title 28, dialog title 22, section title 15-17, body 14-16, labels 13, hints 12-12.5, chips 11-11.5.

## Shape and spacing

- Radius: 6 (small chips), 8 (inputs, small buttons), 10 (buttons, list items), 12-14 (cards), 16-18 (dialogs, hero cards), 999 (pills, progress bars).
- Spacing scale: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32.
- Control heights: 36-40 (small), 42-46 (default), 50-56 (primary CTA).

## Components

- **Primary button:** accent bg, `#101318` text, weight 700, radius 10-12.
- **Secondary button:** `#232936` or `#1F2430` bg, no border.
- **Inputs / selects:** `#1F2430` bg, **no border**, radius 8-12.
- **Segmented control:** grid of buttons; selected = `#F3F4F6` bg + dark text (or accent bg in Import settings); others `#232936`.
- **Switch:** 46x26 pill, on = `#F3F4F6` track with `#101318` knob.
- **Progress bar:** 6-10 px, `#1F2430` track, accent fill.
- **Dialog:** `#171B22`, radius 18, over `rgba(5,7,10,0.74)` scrim, close button top-right.
- **Window controls:** 44x36 transparent buttons, 12 px line icons in `#D4D8DF`.
- **Status chips:** pill, tinted bg with matching light text (see success / warning).
- **Captions in preview:** white bold text, accent highlight, centered at ~62% of frame height, safe zones: top 11%, bottom 22%, right 9%.
