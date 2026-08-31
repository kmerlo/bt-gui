import { useEffect, useState } from 'react'
import { dataApi, priceDataApi, type DataSourceRow } from '../../api/bt'
import { useBtStore } from '../store/btStore'
import { collectTickers } from '../utils/collectTickers'

const S = {
  wrap: {
    width: 300,
    minWidth: 300,
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
  block: { border: '1px solid #30363d', borderRadius: 6, background: '#161b22', padding: 8, gap: 6, display: 'flex', flexDirection: 'column' as const },
  blockRow: { display: 'flex', gap: 4, alignItems: 'center' },
}

const OP_LABELS: Record<string, string> = {
  gt: '>', lt: '<', gte: '>=', lte: '<=', eq: '=', neq: '!=',
  above: 'price >', below: 'price <', cross_over: 'cross_over', cross_down: 'cross_down',
}

type SigBlock = { id: string; indicatorId: number | ''; op: string; threshold: number }

function uid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export default function SignalPanel() {
  const tree = useBtStore((s) => s.tree)
  const tickerStart = useBtStore((s) => s.backtestConfig.start)
  const tickerEnd = useBtStore((s) => s.backtestConfig.end)

  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [indicators, setIndicators] = useState<DataSourceRow[]>([])
  const [signals, setSignals] = useState<DataSourceRow[]>([])
  const [blocks, setBlocks] = useState<SigBlock[]>([
    { id: uid(), indicatorId: '', op: 'gt', threshold: 0 },
  ])
  const [combineOp, setCombineOp] = useState<'and' | 'or'>('and')
  const [nameDraft, setNameDraft] = useState('')
  const [msg, setMsg] = useState('')
  const [computing, setComputing] = useState(false)

  useEffect(() => {
    priceDataApi.list().then((rows) => setAvailableTickers(rows.map((r) => r.symbol))).catch(() => { /* ignore */ })
    dataApi.listIndicators().then(setIndicators).catch(() => { /* ignore */ })
    dataApi.listSignals().then(setSignals).catch(() => { /* ignore */ })
  }, [])

  const treeTickers = tree ? collectTickers(tree.root) : []
  const hasData = treeTickers.some((t) => availableTickers.includes(t))

  const toggleTicker = (sym: string) => {
    setSelectedTickers((prev) => prev.includes(sym) ? prev.filter((t) => t !== sym) : [...prev, sym])
  }

  const addBlock = () => setBlocks((prev) => [...prev, { id: uid(), indicatorId: '', op: 'gt', threshold: 0 }])
  const removeBlock = (id: string) => setBlocks((prev) => prev.filter((b) => b.id !== id))

  const updateBlock = (id: string, patch: Partial<SigBlock>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const buildExpression = (): Record<string, unknown> => {
    if (blocks.length === 0) return { op: 'gt', left: { type: 'value', v: 0 }, right: { type: 'value', v: 0 } }
    const leaf = (b: SigBlock): Record<string, unknown> => {
      const left: Record<string, unknown> = { type: 'indicator', id: String(b.indicatorId) }
      if (['gt', 'lt', 'gte', 'lte', 'eq', 'neq'].includes(b.op)) {
        return { op: b.op, left, right: { type: 'value', v: b.threshold } }
      }
      if (b.op === 'above' || b.op === 'below' || b.op === 'cross_over' || b.op === 'cross_down') {
        return { op: b.op, left }
      }
      return { op: 'gt', left, right: { type: 'value', v: b.threshold } }
    }
    if (blocks.length === 1) return leaf(blocks[0])
    let acc: Record<string, unknown> = leaf(blocks[0])
    for (let i = 1; i < blocks.length; i++) {
      acc = { op: combineOp, left: acc, right: leaf(blocks[i]) }
    }
    return acc
  }

  const handleCompute = async () => {
    if (selectedTickers.length === 0) { setMsg('select at least one ticker'); return }
    const invalidBlock = blocks.find((b) => !b.indicatorId)
    if (invalidBlock) { setMsg('select an indicator for each block'); return }
    setComputing(true)
    setMsg('')
    try {
      const expr = buildExpression()
      const r = await dataApi.computeSignal({
        name: nameDraft.trim() || `signal_${Date.now()}`,
        expression: expr,
        symbols: selectedTickers,
        start: tickerStart || undefined,
        end: tickerEnd || undefined,
        indicator_ids: blocks.map((b) => Number(b.indicatorId)).filter((n) => n > 0),
      })
      setMsg(`saved signal #${r.id}: ${r.name}`)
      setSignals((prev) => [{ id: r.id, name: r.name, type: 'signal', source: 'computed', meta: r.meta, path_or_tickers: selectedTickers.join(',') }, ...prev])
      setNameDraft('')
      window.dispatchEvent(new Event('bt-indicator-refresh'))
    } catch (e) {
      setMsg(String(e))
    } finally {
      setComputing(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={S.title}>Signals</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Tickers</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {treeTickers.length === 0 && <span style={{ fontSize: 11, color: '#8b949e' }}>Nessun ticker nella strategia</span>}
          {treeTickers.length > 0 && !hasData && <span style={{ fontSize: 11, color: '#8b949e' }}>Nessun dato per i ticker della strategia</span>}
          {treeTickers.map((sym) => (
            <button key={sym} type="button" onClick={() => toggleTicker(sym)}
              style={{ background: selectedTickers.includes(sym) ? '#238636' : '#21262d', color: selectedTickers.includes(sym) ? '#fff' : '#8b949e', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
              title={availableTickers.includes(sym) ? `${sym} — dati disponibili` : `${sym} — nessun dato disponibile`}>
              {sym}
            </button>
          ))}
        </div>
      </label>

      <div style={{ borderTop: '1px solid #21262d', margin: '2px 0' }} />

      <div style={S.label}>Expression blocks</div>
      {blocks.map((b, i) => (
        <div key={b.id} style={S.block}>
          <div style={S.blockRow}>
            <select value={b.indicatorId ?? ''} onChange={(e) => updateBlock(b.id, { indicatorId: e.target.value ? Number(e.target.value) : '' })} style={{ ...S.select, flex: 1 }}>
              <option value="">— select indicator —</option>
              {indicators.map((ind) => (
                <option key={ind.id} value={String(ind.id)}>#{ind.id} {ind.name} ({String((ind.meta as Record<string, unknown>)?.indicator_type ?? '?')})</option>
              ))}
            </select>
            <select value={b.op} onChange={(e) => updateBlock(b.id, { op: e.target.value })} style={{ ...S.select, flex: 0, minWidth: 90 }}>
              {Object.entries(OP_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
            </select>
            {!['above', 'below', 'cross_over', 'cross_down'].includes(b.op) && (
              <input type="number" value={b.threshold} onChange={(e) => updateBlock(b.id, { threshold: Number(e.target.value) })} style={{ ...S.input, width: 60 }} title="threshold" />
            )}
            <button type="button" onClick={() => removeBlock(b.id)} style={{ background: 'transparent', border: 'none', color: '#f85149', cursor: 'pointer', fontSize: 14, padding: '0 2px' }}>×</button>
          </div>
          {i < blocks.length - 1 && (
            <div style={{ fontSize: 11, color: '#8b949e', textAlign: 'center' }}>{combineOp.toUpperCase()}</div>
          )}
        </div>
      ))}

      <div style={S.row}>
        <button type="button" onClick={addBlock} style={{ ...S.btn, flex: 1 }}>+ Block</button>
        <select value={combineOp} onChange={(e) => setCombineOp(e.target.value as 'and' | 'or')} style={{ ...S.select, flex: 0, minWidth: 70 }}>
          <option value="and">AND</option>
          <option value="or">OR</option>
        </select>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={S.label}>Name (optional)</span>
        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="auto-generated if empty" style={S.input} />
      </label>

      <button type="button" style={computing ? S.btnDis : S.btn} onClick={handleCompute} disabled={computing}>
        {computing ? 'Computing…' : 'Compute & Save'}
      </button>

      {msg && <span style={S.err}>{msg}</span>}

      {signals.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '2px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.label}>Saved ({signals.length})</span>
          </div>
          <div style={S.list}>
            {signals.map((sig) => (
              <div key={sig.id} style={S.listItem}>
                <div style={S.row}>
                  <span style={{ flex: 1 }}>{sig.name}</span>
                  <span style={S.badge}>signal</span>
                  <button type="button" onClick={() => {
                    dataApi.deleteSignal(sig.id).then(() => setSignals((prev) => prev.filter((x) => x.id !== sig.id))).catch(() => { /* ignore */ })
                  }} style={S.delBtn} title="Delete signal">×</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
