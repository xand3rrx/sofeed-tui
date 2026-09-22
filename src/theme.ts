import type { ThemeName } from './types'

export type Palette = { bg?: string; ink: string; muted: string; soft: string; accent: string; accentDark: string;
  danger: string; success: string }

export const THEMES: { id: ThemeName; name: string; hint: string }[] = [
  { id: 'auto', name: 'Auto', hint: 'Follows your terminal' },
  { id: 'mono', name: 'Mono', hint: 'White and black, no hue' },
  { id: 'paper', name: 'Paper', hint: 'Cream and terracotta' },
  { id: 'sepia', name: 'Sepia', hint: 'Deep parchment and blue' },
  { id: 'rose', name: 'Rosé', hint: 'Pink and damson' },
  { id: 'midnight', name: 'Midnight', hint: 'Navy and sky blue' },
  { id: 'forest', name: 'Forest', hint: 'Moss and mint' },
  { id: 'plum', name: 'Plum', hint: 'Aubergine and violet' },
]

export const THEME_NAMES: ThemeName[] = THEMES.map(theme => theme.id)

type Scheme = { bg: string; ink: string; muted: string; soft: string; accent: string; alert: string }

const autoLight: Scheme = { bg: '#ffffff', ink: '#000000', muted: '#808080', soft: '#e0e0e0', accent: '#4060e0',
  alert: '#ff4000' }
const autoDark: Scheme = { bg: '#000000', ink: '#ffffff', muted: '#808080', soft: '#282828', accent: '#6080e0',
  alert: '#ff4000' }

const PAINTED: Record<Exclude<ThemeName, 'auto'>, Scheme> = {
  mono: { bg: '#ffffff', ink: '#000000', muted: '#565656', soft: '#cfcfcf', accent: '#4d4d4d', alert: '#2b2b2b' },
  paper: { bg: '#f6efe0', ink: '#2e2620', muted: '#7f7361', soft: '#dbcbb0', accent: '#b4622a', alert: '#b3311c' },
  sepia: { bg: '#f3ead3', ink: '#073642', muted: '#5f7475', soft: '#d7c9a5', accent: '#268bd2', alert: '#dc322f' },
  rose: { bg: '#fff0f5', ink: '#3d1526', muted: '#8c5f72', soft: '#f4c8da', accent: '#d81b60', alert: '#c62828' },
  midnight: { bg: '#0d1117', ink: '#e6edf3', muted: '#8b98ad', soft: '#232c38', accent: '#58a6ff', alert: '#f85149' },
  forest: { bg: '#0e1512', ink: '#e2efe7', muted: '#7f9a8c', soft: '#22322a', accent: '#57c98a', alert: '#ef6f6c' },
  plum: { bg: '#150f1e', ink: '#f0e8ff', muted: '#a191b8', soft: '#2c2240', accent: '#c084fc', alert: '#f87171' },
}

function prefersLight() {
  const background = Number(process.env.COLORFGBG?.split(';').at(-1))
  return Number.isFinite(background) && background > 8
}

export function themeScheme(theme: ThemeName): Scheme {
  if (theme === 'auto') return prefersLight() ? autoLight : autoDark
  return PAINTED[theme] ?? autoDark
}

function parseHex(hex: string) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16))
}

export function mixColor(from: string, to: string, amount: number) {
  const start = parseHex(from)
  const end = parseHex(to)
  const channel = (index: number) =>
    Math.round(start[index] + (end[index] - start[index]) * amount).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

export function palette(theme: ThemeName): Palette {
  if (process.env.NO_COLOR !== undefined) {
    return { ink: undefined as any, muted: undefined as any, soft: undefined as any, accent: undefined as any,
      accentDark: undefined as any, danger: undefined as any, success: undefined as any }
  }
  const scheme = themeScheme(theme)
  return {
    bg: scheme.bg,
    ink: scheme.ink,
    muted: scheme.muted,
    soft: scheme.soft,
    accent: scheme.accent,
    accentDark: mixColor(scheme.accent, scheme.ink, 0.3),
    danger: scheme.alert,
    success: scheme.accent,
  }
}
