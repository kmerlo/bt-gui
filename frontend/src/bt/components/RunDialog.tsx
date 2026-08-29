import { useEffect, useState } from 'react'
import { backtestApi, dataApi, type DataSourceRow } from '../../api/bt'
import { useBtStore } from '../store/btStore'

const S = {
  wrap: { border: '1px solid #30363d', borderRadius: 8, padding: 12, background: '#0d1117', color: '#c9d1d9' } as const,
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' } as const,
  btnDis: { background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px' } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
}

export default function RunDialog({ onRunCreated }: { onRunCreated?: (id: number) => void }) {
  const tree = useBtStore((s) => s.tree)
  const priceSourceId = useBtStore((s) => s.priceSourceId)
  const setPriceSourceId = useBtStore((s) => s.setPriceSourceId)
  const backtestConfig = useBtStore((s) => s.backtestConfig)
  const setBacktestConfig = useBtStore((s) => s.setBacktestConfig)
  const extraSourceIds = useBtStore((s) => s.extraSourceIds)
  const indicatorSourceIds = useBtStore((s) => s.indicatorSourceIds)
  const setIndicatorSourceIds = useBtStore((s) => s.setIndicatorSourceIds)
  const [sources, setSources] = useState<DataSourceRow[]>([])
  const [indicators, setIndicators] = useState<DataSourceRow[]>([])
  const [msg, setMsg] = useState('')
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  // derived string for select
  const priceId = priceSourceId != null ? String(priceSourceId) : ''
  const capital = backtestConfig.initial_capital
  const integerPos = backtestConfig.integer_positions
  const simpleFn = backtestConfig.simple_fn

  useEffect(() => {
    dataApi
      .list()
      .then((rows) => {
        setSources(rows)
        setIndicators(rows.filter((r) => r.type === 'indicator'))
      })
      .catch(() => {
        /* ignore */
      })
  }, [])

  const validateFn = (v: string) => {
    if (!v.trim()) return ''
    try {
      const fn = eval(v) as unknown // eslint-disable-line no-eval
      if (typeof fn !== 'function') return 'must be callable'
      if (fn.length < 2) return 'must accept (q,p)'
      return ''
    } catch (e) {
      return String(e)
    }
  }
  const fnError = validateFn(simpleFn)

  const handleRun = async () => {
    if (!tree) {
      setMsg('no tree')
      return
    }
    if (!priceId) {
      setMsg('select price source')
      return
    }
    if (fnError) {
      setMsg(fnError)
      return
    }
    setRunning(true)
    setProgress(0.05)
    setMsg('')
    const config: Record<string, unknown> = {
      initial_capital: capital,
      integer_positions: integerPos,
      commission: { type: 'simple', simple_fn: simpleFn || null },
    }
    // ponytail: union of stored preset indicators + those actually referenced in tree algos
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
      return [...ids].filter((id) => indicators.some((ind) => ind.id === id))
    })()
    // persist referenced union for next reload completeness
    if (referencedIds.length !== indicatorSourceIds.length || referencedIds.some((id, i) => id !== indicatorSourceIds[i])) {
      setIndicatorSourceIds(referencedIds)
    }
    try {
      const res = await backtestApi.create({ tree, config, price_source_id: Number(priceId), extra_source_ids: extraSourceIds, indicator_source_ids: referencedIds })
      const id = res.id
      onRunCreated?.(id)
      setMsg(`run #${id} started`)
      // WS progress
      const ws = backtestApi.wsProgress(id)
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
          setProgress(d.progress)
          if (d.error) setMsg(`error: ${d.error}`)
          if (d.done) {
            ws.close()
            setRunning(false)
            setProgress(1)
          }
        } catch {
          /* ignore */
        }
      }
      ws.onerror = () => {
        // fallback poll
        let tries = 0
        const poll = async () => {
          tries++
          try {
            const r = await backtestApi.getRun(id)
            if (r.stats) {
              setProgress(1)
              setRunning(false)
              return
            }
          } catch {
            /* ignore */
          }
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

  const priceSources = sources.filter((s) => s.type === 'price')

  return (
    <div style={S.wrap}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Run Backtest</div>
      <label style={S.label}>Price source</label>
      <select style={S.input} value={priceId} onChange={(e) => setPriceSourceId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">— select —</option>
        {priceSources.map((s) => (
          <option key={s.id} value={String(s.id)}>
            #{s.id} {s.name}
          </option>
        ))}
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
