/** Dark by default: video review happens in gyms and halls, and a bright UI
 *  around the footage skews how you read the footage itself. */
export const colors = {
  background: '#0B0F14',
  surface: '#141A21',
  surfaceRaised: '#1D2630',
  border: '#2A3540',
  text: '#F2F5F8',
  textMuted: '#8A97A5',
  textFaint: '#5A6673',
  accent: '#4DA3FF',
  accentMuted: '#1E3A57',
  /** Reference clip identity colour, used consistently across every mode. */
  reference: '#4DA3FF',
  /** Comparison clip identity colour. */
  comparison: '#FF9F45',
  danger: '#FF5C5C',
  success: '#43D18A',
  overlay: 'rgba(11, 15, 20, 0.86)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '400' },
  mono: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const;
