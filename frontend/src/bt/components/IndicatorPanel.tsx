import { useEffect, useState } from 'react'
import { dataApi, priceDataApi, type IndicatorDef, type PriceTickerRow } from '../../api/bt'

const S = {
  wrap: {
    width: 260,
    minWidth: 260,
    border: '1px solid #30363d',
    borderRadius: 8,
    background: '#0d1117',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 100px)',
  },
  title: { fontSize: 13, fontWeight: 700, color: '#c9d1d9' },
  label: { fontSize: 12, color: '#8b949e' },
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box' as const },
  select: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box' as const },
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', width: '100%' },
  btnDis: { background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'not-allowed', width: '100%' },
  badge: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' },
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  msg: { fontSize: 11, color: '#8b949e' },
  err: { fontSize: 11, color: '#f85149' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  listItem: { border: '1px solid #30363d', borderRadius: 6, background: '#161b22', padding: '6px 8px', fontSize: 12, color: '#c9d1d9', cursor: 'pointer' },
}

function paramInputs(def: IndicatorDef, values: Record<string, unknown>, onChange: (patch: Record<string, unknown>) => void) {
  return def.params.map((p) => (
    <label key={p.name} style={{ display: 'flex', flexDirection: 'column' as const, gap: 3 }}>
      <span style={S.label}>{p.name}</span>
      <input
        type="number"
        value={String(values[p.name] ?? p.default ?? '')}
        onChange={(e) => onChange({ [p.name]: e.target.value === '' ? p.default : Number(e.target.value) })}
        style={S.input}
      />
    </label>
  ))
}

export default function IndicatorPanel() {
  const [tickers, setTickers] = useState<PriceTickerRow[]>([])
  const [indicators, setIndicators] = useState<{ id: number; name: string; meta: Record<string, unknown> }[]>([])
  const [defs, setDefs] = useState<IndicatorDef[]>([])
  const [selTicker, setSelTicker] = useState('')
  const [selType, setSelType] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nameDraft, setNameDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [computing, setComputing] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    priceDataApi.list().then(setTickers).catch(() => { /* ignore */ })
    dataApi.getIndicatorDefs().then(setDefs).catch(() => { /* ignore */ })
    dataApi.listIndicators().then((rows) =>
      setIndicators(rows.map((r) => ({ id: r.id, name: r.name, meta: r.meta })))
    ).catch(() => { /* ignore */ })
  }, [])

  const selectedDef = defs.find((d) => d.type === selType) ?? null

  const handleCompute = async () => {
    if (!selTicker) { setMsg('select ticker'); return }
    if (!selType) { setMsg('select indicator type'); return }
    setComputing(true)
      setMsg('')
      setWarnings([])
      try {
      const t = tickers.find((r) => r.symbol === selTicker)
      const r = await dataApi.computeIndicator({
        symbol: selTicker,
        start: t?.start || undefined,
        end: t?.end || undefined,
        type: selType,
        params,
        save: true,
        name: nameDraft.trim() || undefined,
      })
      setMsg(`saved ${r.name}`)
      if (r.warnings?.length) {
        setWarnings(r.warnings)
      }
      setIndicators((prev) => [{ id: r.id, name: r.name, meta: r.meta }, ...prev])
      setNameDraft('')
    } catch (e) {
      setMsg(String(e))
    } finally {
      setComputing(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.title}>Indicators</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Ticker</span>
        <select value={selTicker} onChange={(e) => setSelTicker(e.target.value)} style={S.select}>
          <option value="">— select —</option>
          {tickers.map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol} ({t.count} rows)</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Indicator</span>
        <select value={selType} onChange={(e) => { setSelType(e.target.value); setParams({}) }} style={S.select}>
          <option value="">— select —</option>
          {defs.map((d) => (
            <option key={d.type} value={d.type}>{d.display}</option>
          ))}
        </select>
      </label>

      {selectedDef && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {paramInputs(selectedDef, params, (patch) => setParams((prev) => ({ ...prev, ...patch })))}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Name (optional)</span>
        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="auto-generated if empty" style={S.input} />
      </label>

      <button type="button" style={computing ? S.btnDis : S.btn} onClick={handleCompute} disabled={computing}>
        {computing ? 'Computing…' : 'Compute & Save'}
      </button>

      {msg && <span style={S.err}>{msg}</span>}
      {warnings.length > 0 && (
        <div style={{ background: '#3d2c00', border: '1px solid #9e6a16', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#f0c040', lineHeight: 1.5 }}>
          {warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {indicators.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '2px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>Saved ({indicators.length})</span>
          </div>
          <div style={S.list}>
            {indicators.map((ind) => (
              <div key={ind.id} style={S.listItem}>
                <div style={S.row}>
                  <span style={{ flex: 1 }}>{ind.name}</span>
                  <span style={S.badge}>{String(ind.meta?.indicator_type ?? '?')}</span>
                </div>
                {Boolean(ind.meta?.params) && (
                  <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                    {Object.entries(ind.meta.params as Record<string, unknown>).map(([k, v]) => `${k}=${v}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
