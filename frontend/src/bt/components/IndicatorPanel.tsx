import { useEffect, useRef, useState } from 'react'
import { dataApi, priceDataApi, type IndicatorDef } from '../../api/bt'
import { useBtStore } from '../store/btStore'
import { collectTickers } from '../utils/collectTickers'
import DateInputIT from './DateInputIT'

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
  listItem: { border: '1px solid #30363d', borderRadius: 6, background: '#161b22', padding: '6px 8px', fontSize: 12, color: '#c9d1d9' },
  delBtn: { background: 'transparent', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1 },
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
  const tree = useBtStore((s) => s.tree)
  const tickerStart = useBtStore((s) => s.tickerStart)
  const tickerEnd = useBtStore((s) => s.tickerEnd)
  const setTickerStart = useBtStore((s) => s.setTickerStart)
  const setTickerEnd = useBtStore((s) => s.setTickerEnd)

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const initDone = useRef(false)
  const [indicators, setIndicators] = useState<{ id: number; name: string; meta: Record<string, unknown> }[]>([])
  const [defs, setDefs] = useState<IndicatorDef[]>([])
  const [selType, setSelType] = useState('')
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [nameDraft, setNameDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [computing, setComputing] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])

  useEffect(() => {
    priceDataApi.list().then((rows) => setAvailableTickers(rows.map((r) => r.symbol))).catch(() => { /* ignore */ })
    dataApi.getIndicatorDefs().then(setDefs).catch(() => { /* ignore */ })
    dataApi.listIndicators().then((rows) =>
      setIndicators(rows.map((r) => ({ id: r.id, name: r.name, meta: r.meta })))
    ).catch(() => { /* ignore */ })
  }, [])

  // Auto-select all strategy tickers on first data load — runs exactly once per tree
  const treeTickers = tree ? collectTickers(tree.root) : []
  const defaultSelected = treeTickers.filter((t) => availableTickers.includes(t))
  useEffect(() => {
    initDone.current = false
  }, [tree])
  useEffect(() => {
    if (!initDone.current && defaultSelected.length > 0) {
      initDone.current = true
      setSelectedTickers(defaultSelected)
    }
  }, [defaultSelected, tree])
  const hasData = treeTickers.some((t) => availableTickers.includes(t))
  const selectedDef = defs.find((d) => d.type === selType) ?? null

  const toggleTicker = (sym: string) => {
    setSelectedTickers((prev) => prev.includes(sym) ? prev.filter((t) => t !== sym) : [...prev, sym])
  }

  const handleCompute = async () => {
    if (selectedTickers.length === 0) { setMsg('select at least one ticker'); return }
    if (!selType) { setMsg('select indicator type'); return }
    setComputing(true)
    setMsg('')
    setWarnings([])
    const results: { id: number; name: string; meta: Record<string, unknown> }[] = []
    const allWarnings: string[] = []
    try {
      const r = await dataApi.computeIndicator({
        symbols: selectedTickers,
        start: tickerStart || undefined,
        end: tickerEnd || undefined,
        type: selType,
        params,
        save: true,
        name: nameDraft.trim() || undefined,
      })
      // normalize: backend may return single result or list
      const items = Array.isArray(r) ? r : [r]
      for (const item of items) {
        results.push({ id: item.id, name: item.name, meta: item.meta })
        if (item.warnings?.length) allWarnings.push(...item.warnings)
      }
      if (results.length > 0) {
        setMsg(`saved ${results.length} indicator(s)`)
        setIndicators((prev) => [...results, ...prev])
        setNameDraft('')
        // notify other components (AlgoStack) that indicators changed
        window.dispatchEvent(new Event('bt-indicator-refresh'))
      } else {
        setMsg('no indicators saved (check logs)')
      }
    } catch (e) {
      setMsg(String(e))
    } finally {
      setWarnings(allWarnings)
      setComputing(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.title}>Indicators</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Tickers</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {treeTickers.length === 0 && <span style={{ fontSize: 11, color: '#8b949e' }}>Nessun ticker nella strategia</span>}
          {treeTickers.length > 0 && !hasData && <span style={{ fontSize: 11, color: '#8b949e' }}>Nessun dato per i ticker della strategia</span>}
          {treeTickers.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => toggleTicker(sym)}
              style={{
                background: selectedTickers.includes(sym) ? '#238636' : '#21262d',
                color: selectedTickers.includes(sym) ? '#fff' : '#8b949e',
                border: '1px solid #30363d',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 11,
              }}
              title={availableTickers.includes(sym) ? `${sym} — dati disponibili` : `${sym} — nessun dato disponibile`}
            >
              {sym}
            </button>
          ))}
        </div>
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
        <span style={S.label}>Start date</span>
        <DateInputIT value={tickerStart ?? ''} onChange={setTickerStart} style={S.input} placeholder="gg/mm/aaaa" />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>End date</span>
        <DateInputIT value={tickerEnd ?? ''} onChange={setTickerEnd} style={S.input} placeholder="gg/mm/aaaa" />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Name (optional)</span>
        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="auto: TICKER_INDICATOR_params" style={S.input} />
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
                  <button
                    type="button"
                    onClick={() => {
                      dataApi.deleteIndicator(ind.id).then(() =>
                        setIndicators((prev) => prev.filter((x) => x.id !== ind.id))
                      ).catch(() => { /* ignore */ })
                    }}
                    style={S.delBtn}
                    title="Delete indicator"
                  >
                    ×
                  </button>
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
