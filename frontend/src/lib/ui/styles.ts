/**
 * Fragmentos de classe compartilhados entre componentes — não é um design-token system completo
 * (seria abstração demais para o tamanho deste app), só o suficiente para não repetir a mesma
 * string de foco/estado em 10 componentes diferentes.
 */
export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';

export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export const toneClasses: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  success: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  danger: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', dot: 'bg-red-400' },
  warning: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  info: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  neutral: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', dot: 'bg-slate-400' },
};
