import { buildCommissionFn, hasCommissionParams, previewCommissionCost } from '../utils/commission'
import type { CommissionFlags, CommissionParams } from '../utils/commission'

type Props = {
  formula: string
  params: CommissionParams
  flags: CommissionFlags
  onFormula: (v: string) => void
  onParams: (p: Partial<CommissionParams>) => void
  onFlags: (f: Partial<CommissionFlags>) => void
  error: string
}

const S = {
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  num: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
  hint: { fontSize: 11, color: '#8b949e' } as const,
}

// ponytail: '' -> null, NaN -> null (la validazione segnala l'incoerenza)
function toNum(v: string): number | null {
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default function CommissionField({ formula, params, flags, onFormula, onParams, onFlags, error }: Props) {
  const showParams = hasCommissionParams(params)
  const built = buildCommissionFn(params)
  const preview = previewCommissionCost(params, 1000, 100)
  const idleFormula = formula.trim() !== '' && !flags.commission_formula_enabled
  const idleParams = showParams && !flags.commission_params_enabled
  return (
    <div>
      <label style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={flags.commission_formula_enabled} onChange={(e) => onFlags({ commission_formula_enabled: e.target.checked })} />
        Applica formula — Commission simple_fn (lambda q,p: ...)
      </label>
      <textarea
        style={{ ...S.input, minHeight: 60, fontFamily: 'monospace', fontSize: 12 }}
        value={formula}
        onChange={(e) => onFormula(e.target.value)}
        placeholder="lambda q,p: max(1, abs(q)*0.01)"
      />
      {idleFormula && <div style={S.hint}>precompilata, non applicata (flag spento).</div>}
      <label style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={flags.commission_params_enabled} onChange={(e) => onFlags({ commission_params_enabled: e.target.checked })} />
        Applica parametri
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={S.label}>my_commissions_min (€)</label>
          <input style={S.num} type="number" min={0} value={params.my_commissions_min ?? ''} onChange={(e) => onParams({ my_commissions_min: toNum(e.target.value) })} placeholder="es. 1" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>my_commissions_max (€)</label>
          <input style={S.num} type="number" min={0} value={params.my_commissions_max ?? ''} onChange={(e) => onParams({ my_commissions_max: toNum(e.target.value) })} placeholder="vuoto = nessun cap" />
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>my_commissions_perc (%)</label>
          <input style={S.num} type="number" min={0} max={100} step="any" value={params.my_commissions_perc ?? ''} onChange={(e) => onParams({ my_commissions_perc: toNum(e.target.value) })} placeholder="es. 0.1" />
        </div>
      </div>
      <div style={S.hint}>perc in %: 0.1 = 0,1%. Lascia tutto vuoto (o flag spenti) per nessuna commissione.</div>
      {idleParams && <div style={S.hint}>parametri precompilati, non applicati (flag spento).</div>}
      {showParams && built && (
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4, fontFamily: 'monospace' }}>
          generata: {built}{preview != null && <span> — es. q=1000, p=100 → {preview.toFixed(2)} €</span>}
        </div>
      )}
      {error && <div style={{ color: '#f85149', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  )
}
