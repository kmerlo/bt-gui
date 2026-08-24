import { useEffect, useState } from 'react'
import { dataApi, type DataSourceRow, type IndicatorDef } from '../../api/bt'

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
  listItemActive: { border: '1px solid #58a6ff', background: '#1f2b3a' },
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
  const [priceSources, setPriceSources] = useState<DataSourceRow[]>([])
  const [indicators, setIndicators] = useState<DataSourceRow[]>([])
  const [defs, setDefs] = useState<IndicatorDef[]>([])
  const [selPriceId, setSelPriceId] = useState('')
  const [selType, setSelType] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nameDraft, setNameDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [computing, setComputing] = useState(false)
  const [activeIndId, setActiveIndId] = useState<number | null>(null)

  useEffect(() => {
    dataApi.list().then((rows) => {
      setPriceSources(rows.filter((r) => r.type === 'price'))
      setIndicators(rows.filter((r) => r.type === 'indicator'))
    }).catch(() => { /* ignore */ })
    dataApi.getIndicatorDefs().then(setDefs).catch(() => { /* ignore */ })
  }, [])

  const selectedDef = defs.find((d) => d.type === selType) ?? null

  const handleCompute = async () => {
    if (!selPriceId) { setMsg('select price source'); return }
    if (!selType) { setMsg('select indicator type'); return }
    setComputing(true)
    setMsg('')
    try {
      const r = await dataApi.computeIndicator({
        price_source_id: Number(selPriceId),
        type: selType,
        params,
        save: true,
        name: nameDraft.trim() || undefined,
      })
      setMsg(`saved ${r.name}`)
      setIndicators((prev) => [{ id: r.id, name: r.name, type: 'indicator', source: 'computed', meta: r.meta, path_or_tickers: '' }, ...prev])
      setNameDraft('')
      setActiveIndId(r.id)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setComputing(false)
    }
  }

  const handlePreview = async (id: number) => {
    setActiveIndId(id)
    try {
      const p = await dataApi.preview(id)
      // preview shown inline below the list
      void p
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.title}>Indicators</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Price source</span>
        <select value={selPriceId} onChange={(e) => setSelPriceId(e.target.value)} style={S.select}>
          <option value="">— select —</option>
          {priceSources.map((s) => (
            <option key={s.id} value={String(s.id)}>#{s.id} {s.name}</option>
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

      {msg && <span style={msg.startsWith('error') ? S.err : S.msg}>{msg}</span>}

      {indicators.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '2px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>Saved ({indicators.length})</span>
          </div>
          <div style={S.list}>
            {indicators.map((ind) => (
              <div
                key={ind.id}
                style={{ ...S.listItem, ...(activeIndId === ind.id ? S.listItemActive : {}) }}
                onClick={() => handlePreview(ind.id)}
              >
                <div style={S.row}>
                  <span style={{ flex: 1 }}>{ind.name}</span>
                  <span style={S.badge}>{String((ind.meta as Record<string, unknown>)?.indicator_type ?? '?')}</span>
                </div>
                {Boolean((ind.meta as Record<string, unknown>)?.params) && (
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
