import { useEffect, useState } from 'react'
import { backtestApi, priceDataApi } from '../../api/bt'
import { useBtStore } from '../store/btStore'
import type { NodeConfig } from '../../types/bt'

const S = {
  wrap: { border: '1px solid #30363d', borderRadius: 8, padding: 12, background: '#0d1117', color: '#c9d1d9' } as const,
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  select: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' } as const,
  btnDis: { background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px' } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
}

function collectTickers(node: NodeConfig): string[] {
  const tickers: string[] = []
  const walk = (n: NodeConfig) => {
    if (n.type === 'Security' || n.type === 'HedgeSecurity' || n.type === 'CouponPayingSecurity') {
      const t = n.name.trim().toUpperCase()
      if (t && t !== 'NEW_TICKER') tickers.push(t)
    }
    for (const c of n.children) walk(c)
  }
  walk(node)
  return tickers
}

export default function RunDialog({ onRunCreated }: { onRunCreated?: (id: number) => void }) {
  const tree = useBtStore((s) => s.tree)
  const tickerStart = useBtStore((s) => s.tickerStart)
  const tickerEnd = useBtStore((s) => s.tickerEnd)
  const priceColumn = useBtStore((s) => s.priceColumn)
  const setTickerStart = useBtStore((s) => s.setTickerStart)
  const setTickerEnd = useBtStore((s) => s.setTickerEnd)
  const setPriceColumn = useBtStore((s) => s.setPriceColumn)
  const backtestConfig = useBtStore((s) => s.backtestConfig)
  const setBacktestConfig = useBtStore((s) => s.setBacktestConfig)
  const extraSourceIds = useBtStore((s) => s.extraSourceIds)
  const indicatorSourceIds = useBtStore((s) => s.indicatorSourceIds)
  const setIndicatorSourceIds = useBtStore((s) => s.setIndicatorSourceIds)
  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const capital = backtestConfig.initial_capital
  const integerPos = backtestConfig.integer_positions
  const simpleFn = backtestConfig.simple_fn

  useEffect(() => {
    priceDataApi.list().then((rows) => setAvailableTickers(rows.map((r) => r.symbol))).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    if (!tree) return
    const treeTickers = collectTickers(tree.root)
    setSelectedTickers((prev) => {
      const prevSet = new Set(prev)
      const next = [...prevSet]
      for (const t of treeTickers) {
        if (!prevSet.has(t)) next.push(t)
      }
      return next
    })
  }, [tree?.root?.id])

  const validateFn = (v: string) => {
    if (!v.trim()) return ''
    const ok = /^\s*lambda\s+\w+\s*,\s*\w+\s*:/.test(v)
    if (!ok) return 'must be lambda (q,p)'
    // validazione completa al salvataggio (BE)
    return ''
  }
  const fnError = validateFn(simpleFn)

  const toggleTicker = (sym: string) => {
    setSelectedTickers((prev) => prev.includes(sym) ? prev.filter((t) => t !== sym) : [...prev, sym])
  }

  const handleRun = async () => {
    if (!tree) { setMsg('no tree'); return }
    if (selectedTickers.length === 0) { setMsg('select at least one ticker'); return }
    if (fnError) { setMsg(fnError); return }
    setRunning(true)
    setProgress(0.05)
    setMsg('')
    const config = {
      initial_capital: capital,
      integer_positions: integerPos,
      commission: { type: 'simple', simple_fn: simpleFn || null },
      start: tickerStart,
      end: tickerEnd,
      price_column: priceColumn,
    }
    const referencedIds = (() => {
      const ids = new Set<number>(indicatorSourceIds)
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return
        const n = node as Record<string, unknown>
        if (Array.isArray(n.algos)) {
          for (const a of n.algos as Array<Record<string, unknown>>) {
            const params = a.params as Record<string, unknown> | undefined
            if (params) for (const v of Object.values(params)) if (typeof v === 'string' && /^\d+$/.test(v.trim())) ids.add(Number(v))
          }
        }
        if (Array.isArray(n.children)) for (const c of n.children) walk(c)
        if (n.root) walk(n.root)
      }
      walk(tree as unknown)
      return [...ids]
    })()
    if (referencedIds.length !== indicatorSourceIds.length || referencedIds.some((id, i) => id !== indicatorSourceIds[i])) {
      setIndicatorSourceIds(referencedIds)
    }
    try {
      const res = await backtestApi.create({
        tree,
        config,
        tickers: selectedTickers,
        extra_source_ids: extraSourceIds,
        indicator_source_ids: referencedIds,
      })
      const id = res.id
      onRunCreated?.(id)
      setMsg(`run #${id} started`)
      const ws = backtestApi.wsProgress(id)
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
          setProgress(d.progress)
          if (d.error) setMsg(`error: ${d.error}`)
          if (d.done) { ws.close(); setRunning(false); setProgress(1) }
        } catch { /* ignore */ }
      }
      ws.onerror = () => {
        let tries = 0
        const poll = async () => {
          tries++
          try {
            const r = await backtestApi.getRun(id)
            if (r.stats) { setProgress(1); setRunning(false); return }
          } catch { /* ignore */ }
          if (tries < 30) setTimeout(poll, 500)
          else setRunning(false)
        }
        setTimeout(poll, 1000)
      }
    } catch (e) {
      setMsg(String(e))
      setRunning(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Run Backtest</div>
      <label style={S.label}>Tickers</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {availableTickers.length === 0 && <span style={{ fontSize: 12, color: '#8b949e' }}>Nessun ticker — vai su Ticker Catalog per fetchare dati</span>}
        {availableTickers.map((sym) => (
          <button
            key={sym}
            type="button"
            onClick={() => toggleTicker(sym)}
            style={{
              background: selectedTickers.includes(sym) ? '#238636' : '#21262d',
              color: selectedTickers.includes(sym) ? '#fff' : '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {sym}
          </button>
        ))}
      </div>
      <label style={{ ...S.label, marginTop: 8 }}>Start date</label>
      <input type="date" value={tickerStart ?? ''} onChange={(e) => setTickerStart(e.target.value)} style={S.input} />
      <label style={{ ...S.label, marginTop: 8 }}>End date</label>
      <input type="date" value={tickerEnd ?? ''} onChange={(e) => setTickerEnd(e.target.value)} style={S.input} />
      <label style={{ ...S.label, marginTop: 8 }}>Price column</label>
      <select value={priceColumn} onChange={(e) => setPriceColumn(e.target.value as 'close' | 'adj_close')} style={S.select}>
        <option value="close">Close</option>
        <option value="adj_close">Adj Close</option>
      </select>
      <label style={{ ...S.label, marginTop: 8 }}>Initial capital</label>
      <input style={S.input} type="number" value={capital} onChange={(e) => setBacktestConfig({ initial_capital: Number(e.target.value) })} />
      <label style={{ ...S.label, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={integerPos} onChange={(e) => setBacktestConfig({ integer_positions: e.target.checked })} />
        integer positions
      </label>
      <label style={{ ...S.label, marginTop: 8 }}>Commission simple_fn (lambda q,p: ...)</label>
      <textarea
        style={{ ...S.input, minHeight: 60, fontFamily: 'monospace', fontSize: 12 }}
        value={simpleFn}
        onChange={(e) => setBacktestConfig({ simple_fn: e.target.value })}
        placeholder="lambda q,p: max(1, abs(q)*0.01)"
      />
      {fnError && <div style={{ color: '#f85149', fontSize: 12, marginTop: 4 }}>{fnError}</div>}
      <button type="button" style={running ? S.btnDis : S.btn} onClick={handleRun} disabled={running}>
        {running ? 'Running…' : 'Run'}
      </button>
      {running && (
        <div style={{ marginTop: 8, background: '#21262d', borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, background: '#238636', height: '100%' }} />
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
