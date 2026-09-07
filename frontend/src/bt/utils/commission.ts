// Logica pura per la doppia modalità commissioni (formula libera | 3 parametri).
// Zero JSX, zero store: riusata da RunDialog, SettingsView e buildPresetForTree.
// La formula generata usa solo max/min/abs + aritmetica -> passa la whitelist BE
// di backend/services/commission_parser.py senza toccare il backend.

export type CommissionParams = {
  my_commissions_min: number | null
  my_commissions_max: number | null
  my_commissions_perc: number | null
}

export type CommissionFlags = {
  commission_formula_enabled: boolean
  commission_params_enabled: boolean
}

// ponytail: taglia artefatti float (es. 0.07/100) senza dipendenze
function fmt(n: number): string {
  return String(Number(n.toPrecision(12)))
}

export function hasCommissionParams(p: CommissionParams): boolean {
  return p.my_commissions_min != null || p.my_commissions_max != null || p.my_commissions_perc != null
}

function paramsError(p: CommissionParams): string {
  const mn = p.my_commissions_min
  const mx = p.my_commissions_max
  const pc = p.my_commissions_perc
  if (pc == null) return 'commissioni: indica my_commissions_perc (0..100)'
  if (!(pc > 0) || pc > 100) return 'commissioni: perc deve stare in 0..100'
  if (mn != null && !(mn >= 0)) return 'commissioni: min ≥ 0'
  if (mx != null && !(mx >= 0)) return 'commissioni: max ≥ 0'
  if (mn != null && mx != null && mx < mn) return 'commissioni: max ≥ min'
  return ''
}

/** '' = valido. Solo il flag attivo applica i valori (precompilati ammessi); entrambi i flag = errore. */
export function validateCommission(formula: string, p: CommissionParams, f: CommissionFlags): string {
  if (f.commission_formula_enabled && f.commission_params_enabled)
    return 'commissioni: attiva o la formula o i parametri, non entrambi'
  if (f.commission_formula_enabled) {
    if (!formula.trim()) return 'commissioni: flag formula attivo ma formula vuota'
    const ok = /^\s*lambda\s+\w+\s*,\s*\w+\s*:/.test(formula)
    if (!ok) return 'must be lambda (q,p)'
    return ''
  }
  if (f.commission_params_enabled) {
    if (!hasCommissionParams(p)) return 'commissioni: flag parametri attivo ma nessun parametro'
    return paramsError(p)
  }
  return ''
}

/** Compone lambda q,p: max(MIN, min(MAX, p*abs(q)*frac)) — max omesso se vuoto, max() omesso se min nullo/0. */
export function buildCommissionFn(p: CommissionParams): string | null {
  if (!hasCommissionParams(p) || paramsError(p)) return null
  const pc = p.my_commissions_perc as number
  const mn = p.my_commissions_min
  const mx = p.my_commissions_max
  let expr = `p*abs(q)*${fmt(pc / 100)}`
  if (mx != null) expr = `min(${fmt(mx)}, ${expr})`
  if (mn != null && mn > 0) expr = `max(${fmt(mn)}, ${expr})`
  return `lambda q,p: ${expr}`
}

/** Formula effettiva da inviare al BE: solo il flag attivo applica, altrimenti '' (nessuna commissione). */
export function resolveCommissionFn(formula: string, p: CommissionParams, f: CommissionFlags): string {
  if (f.commission_formula_enabled) return formula.trim()
  if (f.commission_params_enabled) return buildCommissionFn(p) ?? ''
  return ''
}

/** Anteprima costo in aritmetica pura (mai eval) — null se parametri invalidi. */
export function previewCommissionCost(p: CommissionParams, qty: number, price: number): number | null {
  if (!hasCommissionParams(p) || paramsError(p)) return null
  const pc = p.my_commissions_perc as number
  let c = price * Math.abs(qty) * (pc / 100)
  if (p.my_commissions_max != null) c = Math.min(p.my_commissions_max, c)
  if (p.my_commissions_min != null) c = Math.max(p.my_commissions_min, c)
  return c
}
