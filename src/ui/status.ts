export type StatusTone =
  | 'neutral'
  | 'progress'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'

export type StatusGlyph = 'dot' | 'half' | 'search' | 'check' | 'alert' | 'clock' | 'slash'

export type StatusPresentation = {
  tone: StatusTone
  label: string
  glyph: StatusGlyph
}
