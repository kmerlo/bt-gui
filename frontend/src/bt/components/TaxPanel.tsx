import { useEffect, useState } from 'react'
import { taxProfilesApi, type TaxProfile } from '../../api/tax'
import { useBtStore } from '../store/btStore'

const S = {
  box: { border: '1px solid #30363d', borderRadius: 6, padding: 8, marginTop: 8, background: '#010409' } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: 90 } as const,
  select: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 6px', maxWidth: 150 } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const } as const,
  err: { color: '#f85149', fontSize: 12, marginTop: 4 } as const,
}

export function validateTaxRate(v: number): string {
  if (!Number.isFinite(v)) return 'aliquota non valida'
  if (v < 0 || v > 100) return 'aliquota 0..100'
  return ''
}

export default function TaxPanel({ tickers }: { tickers: string[] }) {
  const backtestConfig = useBtStore((s) => s.backtestConfig)
  const setBacktestConfig = useBtStore((s) => s.setBacktestConfig)
  const [profiles, setProfiles] = useState<TaxProfile[]>([])
  const [showMap, setShowMap] = useState(false)

  useEffect(() => {
    taxProfilesApi.list().then(setProfiles).catch(() => { /* offline: solo default */ })
  }, [])

  const gainErr = validateTaxRate(backtestConfig.tax_gain_rate)
  const divErr = validateTaxRate(backtestConfig.tax_div_rate)

  const setMapping = (ticker: string, pid: number | null) => {
    const next = { ...backtestConfig.ticker_tax_profile }
    if (pid == null) delete next[ticker]
    else next[ticker] = pid
    setBacktestConfig({ ticker_tax_profile: next })
  }

  return (
    <div style={S.box}>
      <label style={{ ...S.label, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={backtestConfig.tax_enabled} onChange={(e) => setBacktestConfig({ tax_enabled: e.target.checked })} />
        Tassazione (gain immediata + zainetto 4 anni)
      </label>
      {backtestConfig.tax_enabled && (
        <>
          <div style={S.row}>
            <span style={{ fontSize: 12 }}>
              Gain % <input style={S.input} type="number" min={0} max={100} step={0.5} value={backtestConfig.tax_gain_rate}
                onChange={(e) => setBacktestConfig({ tax_gain_rate: Number(e.target.value) })} />
            </span>
            <span style={{ fontSize: 12 }}>
              Dividendi % <input style={S.input} type="number" min={0} max={100} step={0.5} value={backtestConfig.tax_div_rate}
                onChange={(e) => setBacktestConfig({ tax_div_rate: Number(e.target.value) })} />
            </span>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={backtestConfig.tax_use_carry} onChange={(e) => setBacktestConfig({ tax_use_carry: e.target.checked })} />
              zainetto
            </label>
          </div>
          {(gainErr || divErr) && <div style={S.err}>{gainErr || divErr}</div>}
          <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
            Dividendi/coupon sempre tassati, mai compensati. Minus usabili fino al 31/12 del 4° anno dopo.
          </div>
          <button type="button" onClick={() => setShowMap((v) => !v)}
            style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 12, padding: '4px 0' }}>
            {showMap ? '▾' : '▸'} Profili per ticker ({Object.keys(backtestConfig.ticker_tax_profile).length})
          </button>
          {showMap && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              {tickers.length === 0 && <span style={{ fontSize: 11, color: '#8b949e' }}>nessun ticker selezionato</span>}
              {tickers.map((t) => (
                <div key={t} style={{ ...S.row, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{t}</span>
                  <select style={S.select} value={backtestConfig.ticker_tax_profile[t] ?? ''}
                    onChange={(e) => setMapping(t, e.target.value ? Number(e.target.value) : null)}>
                    <option value="">default ({backtestConfig.tax_gain_rate}/{backtestConfig.tax_div_rate}%)</option>
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.gain_rate}/{p.div_rate}%)</option>)}
                  </select>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#8b949e' }}>Profili globali in Settings → Profili fiscali.</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
