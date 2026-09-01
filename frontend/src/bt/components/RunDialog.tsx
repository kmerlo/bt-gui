import { useEffect, useRef, useState } from 'react'
import { backtestApi, priceDataApi } from '../../api/bt'
import { loadSettings } from '../../api/settings'
import { useBtStore } from '../store/btStore'
import { collectTickers } from '../utils/collectTickers'
import DateInputIT from './DateInputIT'

const S = {
  wrap: { border: '1px solid #30363d', borderRadius: 8, padding: 12, background: '#0d1117', color: '#c9d1d9' } as const,
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  select: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' } as const,
  btnDis: { background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px' } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
}

export default function RunDialog({ onRunCreated }: { onRunCreated?: (id: number) => void }) {
  const tree = useBtStore((s) => s.tree)
  const tickerStart = useBtStore((s) => s.tickerStart)
  const tickerEnd = useBtStore((s) => s.tickerEnd)
  const setTickerStart = useBtStore((s) => s.setTickerStart)
  const setTickerEnd = useBtStore((s) => s.setTickerEnd)
  const backtestConfig = useBtStore((s) => s.backtestConfig)
  const setBacktestConfig = useBtStore((s) => s.setBacktestConfig)
  const extraSourceIds = useBtStore((s) => s.extraSourceIds)
  const indicatorSourceIds = useBtStore((s) => s.indicatorSourceIds)
  const setIndicatorSourceIds = useBtStore((s) => s.setIndicatorSourceIds)
  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const initDone = useRef(false)
  const [msg, setMsg] = useState('')
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<number | null>(null)
  const [indicatorWarnings, setIndicatorWarnings] = useState<string[]>([])
  const abortRef = useRef({ stopped: false, pollTimer: -1 as number })
  const wsRef = useRef<WebSocket | null>(null)
  const capital = backtestConfig.initial_capital
  const integerPos = backtestConfig.integer_positions
  const simpleFn = backtestConfig.simple_fn

  useEffect(() => {
    priceDataApi.list().then((rows) => setAvailableTickers(rows.map((r) => r.symbol))).catch(() => { /* ignore */ })
  }, [])

  // Auto-select all tree tickers that have data available — runs exactly once per tree
  useEffect(() => {
    initDone.current = false
  }, [tree])
  useEffect(() => {
    const ids = tree ? collectTickers(tree.root) : []
    const known = ids.filter((t) => availableTickers.includes(t))
    if (!initDone.current && known.length > 0) {
      initDone.current = true
      setSelectedTickers(known)
    }
  }, [availableTickers, tree])

  useEffect(() => {
    const id = runId
    if (id == null) return
    const ws = backtestApi.wsProgress(id)
    wsRef.current = ws
    abortRef.current = { stopped: false, pollTimer: -1 }
    const onMsg = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
        setProgress(d.progress)
        if (d.error) setMsg(`error: ${d.error}`)
        if (d.done) { ws.close(); setRunning(false); setProgress(1) }
      } catch { /* ignore */ }
    }
    const onErr = () => {
      let tries = 0
      const poll = async () => {
        if (abortRef.current.stopped) return
        tries++
        try {
          const r = await backtestApi.getRun(id)
          if (r.stats) { setProgress(1); setRunning(false); return }
        } catch { /* ignore */ }
        if (tries >= 30) { setRunning(false); return }
        abortRef.current.pollTimer = window.setTimeout(poll, 500) as unknown as number
      }
      abortRef.current.pollTimer = window.setTimeout(poll, 1000) as unknown as number
    }
    ws.addEventListener('message', onMsg)
    ws.addEventListener('error', onErr)
    return () => {
      abortRef.current.stopped = true
      if (abortRef.current.pollTimer) window.clearTimeout(abortRef.current.pollTimer)
      ws.close()
      ws.removeEventListener('message', onMsg)
      ws.removeEventListener('error', onErr)
      wsRef.current = null
    }
  }, [runId])

  const treeTickers = tree ? collectTickers(tree.root) : []

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
    setRunId(null)
    setMsg('')
    const config = {
      initial_capital: capital,
      integer_positions: integerPos,
      commission: { type: 'simple', simple_fn: simpleFn || null },
      start: tickerStart,
      end: tickerEnd,
      price_column: loadSettings().price_column,
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
      onRunCreated?.(res.id)
      if (res.warnings?.length) {
        setIndicatorWarnings(res.warnings)
        setMsg(`run #${res.id} started (⚠️ ${res.warnings.length} warning(i))`)
      } else {
        setMsg(`run #${res.id} started`)
      }
      setRunId(res.id)
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
        {treeTickers.length === 0 && <span style={{ fontSize: 12, color: '#8b949e' }}>Nessun ticker nella strategia — aggiungi Security alla tree</span>}
        {treeTickers.length > 0 && availableTickers.filter((sym) => treeTickers.includes(sym)).length === 0 && <span style={{ fontSize: 12, color: '#8b949e' }}>Nessun dato disponibile per i ticker della strategia</span>}
        {availableTickers.filter((sym) => treeTickers.includes(sym)).map((sym) => (
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
      <DateInputIT value={tickerStart ?? ''} onChange={setTickerStart} style={S.input} />
      <label style={{ ...S.label, marginTop: 8 }}>End date</label>
      <DateInputIT value={tickerEnd ?? ''} onChange={setTickerEnd} style={S.input} />
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
      {indicatorWarnings.length > 0 && (
        <div style={{ marginTop: 8, background: '#3d2c00', border: '1px solid #9e6a16', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#f0c040', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Indicatori obsoleti rilevati</div>
          {indicatorWarnings.map((w, i) => <div key={i}>{w}</div>)}
          <div style={{ marginTop: 6, color: '#c9d1d9' }}>
            Per risolvere: vai nella sezione <b>Indicators</b>, seleziona il ticker interessato e premi <b>Compute & Save</b> per ricalcolare con i dati più recenti.
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
