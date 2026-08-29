import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries, AreaSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts'
import { backtestApi, formatCreatedAt, type RunRow } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 2 } as const,
  thFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', position: 'sticky' as const, top: 32, zIndex: 2 } as const,
  thCb: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'center' as const, position: 'sticky' as const, top: 0, zIndex: 2, width: 36 } as const,
  thCbFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', textAlign: 'center' as const, position: 'sticky' as const, top: 32, zIndex: 2, width: 36 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  inputSm: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '4px 6px', width: '100%', fontSize: 12 } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnSmall: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #238636', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
}

function toTime(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}

function sanitizeLine(dates: string[], values: number[]) {
  const out: { time: number; value: number }[] = []
  for (let i = 0; i < dates.length; i++) {
    const v = values[i]
    if (v == null || Number.isNaN(v)) continue
    const time = toTime(dates[i] ?? '')
    if (!time) continue
    out.push({ time, value: v })
  }
  return out
}

function buildDrawdown(values: number[], dates: string[]) {
  let peak = -Infinity
  const out: { time: number; value: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0
    if (v > peak) peak = v
    const dd = peak ? (v / peak - 1) * 100 : 0
    const time = toTime(dates[i] ?? '')
    if (time) out.push({ time, value: dd })
  }
  return out
}

// ponytail: ffn PerformanceStats "p" keys -> percent formatting (same as ffn/utils fmtp but it-IT)
const PERCENT_KEYS = new Set([
  'rf', 'total_return', 'cagr', 'max_drawdown', 'max_dd',
  'mtd', 'three_month', 'six_month', 'ytd', 'one_year', 'three_year', 'five_year', 'ten_year', 'incep',
  'daily_mean', 'daily_vol', 'best_day', 'worst_day',
  'monthly_mean', 'monthly_vol', 'best_month', 'worst_month',
  'yearly_mean', 'yearly_vol', 'best_year', 'worst_year',
  'avg_drawdown', 'avg_up_month', 'avg_down_month', 'win_year_perc', 'twelve_month_win_perc',
])

// ponytail: grouping for metrics — A: daily/monthly/yearly + related keys
const METRIC_GROUPS: { id: string; label: string; match: (k: string) => boolean }[] = [
  { id: 'daily', label: 'Daily', match: (k) => k.includes('daily') || k === 'best_day' || k === 'worst_day' },
  { id: 'monthly', label: 'Monthly', match: (k) => k.includes('monthly') || ['best_month', 'worst_month', 'avg_up_month', 'avg_down_month', 'twelve_month_win_perc'].includes(k) },
  { id: 'yearly', label: 'Yearly', match: (k) => k.includes('yearly') || ['best_year', 'worst_year', 'win_year_perc', 'one_year', 'three_year', 'five_year', 'ten_year', 'incep'].includes(k) },
]

function formatMetric(key: string, v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (PERCENT_KEYS.has(key.toLowerCase())) {
      // it-IT: 0.3915 -> "39,15%"
      return `${(v * 100).toFixed(2).replace('.', ',')}%`
    }
    return v.toFixed(4)
  }
  return String(v).slice(0, 120)
}

export default function ResultsDashboard({ runId }: { runId: number | null }) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [sel, setSel] = useState<number | null>(runId)
  const [prices, setPrices] = useState<{ dates: string[]; values: number[] } | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [tx, setTx] = useState<Record<string, unknown>[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [fId, setFId] = useState('')
  const [fStrategyName, setFStrategyName] = useState('')
  const [fCreatedAt, setFCreatedAt] = useState('')
  const [fStart, setFStart] = useState('')
  const [fEnd, setFEnd] = useState('')
  const [fTotalReturn, setFTotalReturn] = useState('')
  const [fMaxDrawdown, setFMaxDrawdown] = useState('')
  const [fSharpe, setFSharpe] = useState('')
  const [fSortino, setFSortino] = useState('')
  const [fStats, setFStats] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const chartRef = useRef<HTMLDivElement | null>(null)
  const ddRef = useRef<HTMLDivElement | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const groupedMetrics = useMemo(() => {
    if (!stats) return null
    const entries = Object.entries(stats)
    const used = new Set<string>()
    const groups = METRIC_GROUPS.map((g) => {
      const rows = entries.filter(([k]) => g.match(k.toLowerCase()))
      for (const [k] of rows) used.add(k)
      return { ...g, rows }
    })
    const otherRows = entries.filter(([k]) => !used.has(k))
    return { groups, otherRows }
  }, [stats])

  useEffect(() => { setSel(runId) }, [runId])

  const refresh = useCallback(() => {
    backtestApi
      .listRuns({
        search: search || undefined,
        sort_by: sortBy ?? undefined,
        sort_dir: sortDir,
        filter_id: fId || undefined,
        filter_strategy_name: fStrategyName || undefined,
        filter_created_at: fCreatedAt || undefined,
        filter_start: fStart || undefined,
        filter_end: fEnd || undefined,
        filter_total_return: fTotalReturn || undefined,
        filter_max_drawdown: fMaxDrawdown || undefined,
        filter_sharpe: fSharpe || undefined,
        filter_sortino: fSortino || undefined,
        filter_stats: fStats || undefined,
      })
      .then((data) => {
        setRuns(data)
        setSelected((prev) => {
          const ids = new Set(data.map((r) => r.id))
          const n = new Set<number>()
          for (const id of prev) if (ids.has(id)) n.add(id)
          return n
        })
      })
      .catch((e: unknown) => setMsg(String(e)))
  }, [search, sortBy, sortDir, fId, fStrategyName, fCreatedAt, fStart, fEnd, fTotalReturn, fMaxDrawdown, fSharpe, fSortino, fStats])

  const loadDetail = useCallback((id: number) => {
    backtestApi
      .getRun(id)
      .then((r) => {
        setStats((r.stats as Record<string, unknown>) ?? null)
        setTx((r.transactions as Record<string, unknown>[]) ?? [])
      })
      .catch(() => { /* ignore */ })
    backtestApi
      .getPrices(id)
      .then(setPrices)
      .catch(() => { /* ignore */ })
  }, [])

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (sel === id) { setSel(null); setStats(null); setPrices(null); setTx([]) }
      } else {
        next.add(id)
        setSel(id)
        loadDetail(id)
      }
      return next
    })
  }, [sel, loadDetail])

  useEffect(() => { refresh() }, [refresh])

  // ponytail: auto-refresh finché qualche run è ancora in "running" (stats == null)
  const hasRunning = runs.some((r) => r.stats == null)
  useEffect(() => {
    if (!hasRunning) return
    const t = setInterval(() => refresh(), 1500)
    return () => clearInterval(t)
  }, [hasRunning, refresh])

  useEffect(() => {
    if (sel == null) return
    loadDetail(sel)
  }, [sel, loadDetail])

  // ponytail: synced equity + drawdown (pan/zoom + crosshair via native lightweight-charts API)
  useEffect(() => {
    if (!chartRef.current || !ddRef.current || !prices || prices.dates.length === 0) return
    const eqEl = chartRef.current
    const ddEl = ddRef.current

    const eqChart: IChartApi = createChart(eqEl, { layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' }, width: eqEl.clientWidth, height: 260, grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } } })
    const ddChart: IChartApi = createChart(ddEl, { layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' }, width: ddEl.clientWidth, height: 160, grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } } })

    const eqSeries: ISeriesApi<'Line'> = eqChart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2 })
    const ddSeries: ISeriesApi<'Area'> = ddChart.addSeries(AreaSeries, { lineColor: '#f85149', topColor: 'rgba(248,81,73,0.4)', bottomColor: 'rgba(248,81,73,0.0)' })

    const eqData = sanitizeLine(prices.dates, prices.values)
    const ddData = buildDrawdown(prices.values, prices.dates)
    eqSeries.setData(eqData as never)
    ddSeries.setData(ddData as never)
    eqChart.timeScale().fitContent()
    ddChart.timeScale().fitContent()

    // maps for crosshair price lookup (time -> value)
    const eqMap = new Map<number, number>(eqData.map((d) => [d.time, d.value]))
    const ddMap = new Map<number, number>(ddData.map((d) => [d.time, d.value]))

    let syncing = false

    const onEqLogical = (range: { from: number; to: number } | null) => {
      if (syncing || !range) return
      syncing = true
      try { ddChart.timeScale().setVisibleLogicalRange(range) } catch { /* ignore */ }
      syncing = false
    }
    const onDdLogical = (range: { from: number; to: number } | null) => {
      if (syncing || !range) return
      syncing = true
      try { eqChart.timeScale().setVisibleLogicalRange(range) } catch { /* ignore */ }
      syncing = false
    }
    eqChart.timeScale().subscribeVisibleLogicalRangeChange(onEqLogical)
    ddChart.timeScale().subscribeVisibleLogicalRangeChange(onDdLogical)

    const onEqCrosshair = (param: MouseEventParams<Time>) => {
      if (syncing) return
      if (!param.time || !param.point) { ddChart.clearCrosshairPosition(); return }
      const t = param.time as unknown as number
      const price = ddMap.get(t)
      if (price == null) { ddChart.clearCrosshairPosition(); return }
      syncing = true
      try { ddChart.setCrosshairPosition(price, param.time, ddSeries) } catch { /* ignore */ }
      syncing = false
    }
    const onDdCrosshair = (param: MouseEventParams<Time>) => {
      if (syncing) return
      if (!param.time || !param.point) { eqChart.clearCrosshairPosition(); return }
      const t = param.time as unknown as number
      const price = eqMap.get(t)
      if (price == null) { eqChart.clearCrosshairPosition(); return }
      syncing = true
      try { eqChart.setCrosshairPosition(price, param.time, eqSeries) } catch { /* ignore */ }
      syncing = false
    }
    eqChart.subscribeCrosshairMove(onEqCrosshair)
    ddChart.subscribeCrosshairMove(onDdCrosshair)

    const roEq = new ResizeObserver(() => eqChart.applyOptions({ width: eqEl.clientWidth }))
    const roDd = new ResizeObserver(() => ddChart.applyOptions({ width: ddEl.clientWidth }))
    roEq.observe(eqEl)
    roDd.observe(ddEl)

    return () => {
      try { eqChart.timeScale().unsubscribeVisibleLogicalRangeChange(onEqLogical) } catch { /* ignore */ }
      try { ddChart.timeScale().unsubscribeVisibleLogicalRangeChange(onDdLogical) } catch { /* ignore */ }
      try { eqChart.unsubscribeCrosshairMove(onEqCrosshair) } catch { /* ignore */ }
      try { ddChart.unsubscribeCrosshairMove(onDdCrosshair) } catch { /* ignore */ }
      roEq.disconnect()
      roDd.disconnect()
      eqChart.remove()
      ddChart.remove()
    }
  }, [prices])

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('asc') }
  }
  const sortIcon = (col: string) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕')

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(runs.map((r) => r.id)))
    else setSelected(new Set())
  }
  const handleDeleteOne = async (id: number) => {
    if (!window.confirm(`Eliminare run #${id}?`)) return
    try {
      await backtestApi.deleteRun(id)
      setMsg(`[ok] eliminato run #${id}`)
      if (sel === id) { setSel(null); setStats(null); setPrices(null); setTx([]) }
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      setExpanded((prev) => { const n = new Set(prev); n.delete(id); return n })
      refresh()
    } catch (e) { setMsg(`[err] ${String(e)}`) }
  }
  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Eliminare ${selected.size} run selezionati?`)) return
    try {
      const r = await backtestApi.bulkDeleteRuns([...selected])
      setMsg(`[ok] eliminati ${r.deleted} run`)
      if (sel !== null && selected.has(sel)) { setSel(null); setStats(null); setPrices(null); setTx([]) }
      setSelected(new Set())
      setExpanded((prev) => { const n = new Set(prev); for (const id of selected) n.delete(id); return n })
      refresh()
    } catch (e) { setMsg(`[err] ${String(e)}`) }
  }
  const resetFilters = () => {
    setSearch(''); setSearchDraft('')
    setFId(''); setFStrategyName(''); setFCreatedAt(''); setFStart(''); setFEnd(''); setFTotalReturn(''); setFMaxDrawdown(''); setFSharpe(''); setFSortino(''); setFStats('')
    setSortBy(null); setSortDir('asc')
  }
  const allChecked = runs.length > 0 && runs.every((r) => selected.has(r.id))
  const hasFilter = search || sortBy || fId || fStrategyName || fCreatedAt || fStart || fEnd || fTotalReturn || fMaxDrawdown || fSharpe || fSortino || fStats

  return (
    <div style={S.wrap}>
      <style>{`@keyframes bt-progress{0%{transform:translateX(-100%)}50%{transform:translateX(150%)}100%{transform:translateX(-100%)}}`}</style>
      <h3 style={{ margin: '0 0 12px' }}>Results</h3>
      {hasRunning && <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>⏳ {runs.filter((r) => r.stats == null).length} run in esecuzione — aggiornamento automatico ogni 1,5s</div>}
      <div style={S.row}>
        <input style={S.input} placeholder="cerca globale" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchDraft) }} />
        <button type="button" style={S.btn} onClick={() => setSearch(searchDraft)}>Filtra</button>
        {hasFilter && <button type="button" style={S.btn} onClick={resetFilters}>Reset</button>}
        <button type="button" style={S.btn} onClick={refresh}>Refresh</button>
        <span style={{ fontSize: 12, color: '#8b949e' }}>{runs.length} run{search || fId || fCreatedAt || fStart || fEnd || fStats ? ' (filtrati)' : ''}{selected.size > 0 ? ` · selezionati: ${selected.size}` : ''}{expanded.size > 0 ? ` · espansi: ${expanded.size}` : ''}{sel ? ` · selezionato: #${sel}` : ''}</span>
      </div>
      {selected.size > 0 && (
        <div style={{ ...S.row, marginBottom: 8 }}>
          <button type="button" style={S.btnDanger} onClick={handleBulkDelete}>Elimina selezionati ({selected.size})</button>
          <button type="button" style={S.btn} onClick={() => setSelected(new Set())}>Deseleziona</button>
        </div>
      )}
      {msg && <div style={msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{msg}</div>}

      <div style={{ overflow: 'auto', maxHeight: '50vh', border: '1px solid #30363d', borderRadius: 6, marginBottom: 12 }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thCb}><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} title="Seleziona tutti" /></th>
              <th style={S.th} onClick={() => handleSort('id')}>id{sortIcon('id')}</th>
              <th style={S.th} onClick={() => handleSort('strategy_name')}>strategy{sortIcon('strategy_name')}</th>
              <th style={S.th} onClick={() => handleSort('created_at')}>created_at{sortIcon('created_at')}</th>
              <th style={S.th} onClick={() => handleSort('start')}>start{sortIcon('start')}</th>
              <th style={S.th} onClick={() => handleSort('end')}>end{sortIcon('end')}</th>
              <th style={S.th} onClick={() => handleSort('total_return')}>Total Return{sortIcon('total_return')}</th>
              <th style={S.th} onClick={() => handleSort('max_drawdown')}>Max DD{sortIcon('max_drawdown')}</th>
              <th style={S.th} onClick={() => handleSort('sharpe')}>Shārpe{sortIcon('sharpe')}</th>
              <th style={S.th} onClick={() => handleSort('sortino')}>Sortino{sortIcon('sortino')}</th>
              <th style={S.th} onClick={() => handleSort('cagr')}>CAGR{sortIcon('cagr')}</th>
              <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>View</th>
              <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Delete</th>
            </tr>
            <tr>
              <th style={S.thCbFilter}></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra id" value={fId} onChange={(e) => setFId(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra strategy" value={fStrategyName} onChange={(e) => setFStrategyName(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra created_at" value={fCreatedAt} onChange={(e) => setFCreatedAt(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra start" value={fStart} onChange={(e) => setFStart(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra end" value={fEnd} onChange={(e) => setFEnd(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Total Return" value={fTotalReturn} onChange={(e) => setFTotalReturn(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Max DD" value={fMaxDrawdown} onChange={(e) => setFMaxDrawdown(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Shārpe" value={fSharpe} onChange={(e) => setFSharpe(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Sortino" value={fSortino} onChange={(e) => setFSortino(e.target.value)} /></th>
              <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra CAGR" value={fStats} onChange={(e) => setFStats(e.target.value)} /></th>
              <th style={S.thFilter}></th>
              <th style={S.thFilter}></th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr><td style={S.td} colSpan={12}>{hasFilter ? 'nessun run (filtrato) — premi Reset' : 'no runs yet — run a backtest from Builder'}</td></tr>
            ) : runs.map((r) => {
              const cagr = r.cagr
              const tr = r.total_return
              const md = r.max_drawdown
              const sh = r.sharpe
              const so = r.sortino
              const isExpanded = expanded.has(r.id)
              return (
                <tr key={r.id} style={sel === r.id ? { background: '#161b22' } : undefined}>
                  <td style={{ ...S.td, textAlign: 'center' as const }}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                  <td style={S.td}>{r.id}</td>
                  <td style={S.td} title={r.strategy_name ?? (r.config as Record<string, unknown>)?.['strategy_name'] as string ?? ''}>{r.strategy_name ?? ((r.config as Record<string, unknown>)?.['strategy_name'] as string | undefined) ?? <span style={{ color: '#8b949e' }}>{r.strategy_id != null ? `— (deleted #${r.strategy_id})` : '—'}</span>}</td>
                  <td style={S.td}>{formatCreatedAt(r.created_at)}</td>
                  <td style={S.td}>{r.start ?? ''}</td>
                  <td style={S.td}>{r.end ?? ''}</td>
                  <td style={{ ...S.td, color: (typeof tr === 'number' && tr < 0) ? '#f85149' : (typeof tr === 'number' && tr > 0.1) ? '#3fb950' : '#c9d1d9' }}>
                    {typeof tr === 'number' ? `${(tr * 100).toFixed(2).replace('.', ',')}%` : '—'}
                  </td>
                  <td style={{ ...S.td, color: typeof md === 'number' && md < 0 ? '#f85149' : '#c9d1d9' }}>
                    {typeof md === 'number' ? `${(md * 100).toFixed(2).replace('.', ',')}%` : '—'}
                  </td>
                  <td style={S.td}>{typeof sh === 'number' ? sh.toFixed(2) : '—'}</td>
                  <td style={S.td}>{typeof so === 'number' ? so.toFixed(2) : '—'}</td>
                  <td style={{ ...S.td, color: (typeof cagr === 'number' && cagr < 0) ? '#f85149' : (typeof cagr === 'number' && cagr > 0.1) ? '#3fb950' : '#c9d1d9' }}>
                    {r.stats ? (typeof cagr === 'number' ? `${(cagr * 100).toFixed(2).replace('.', ',')}%` : '—') : '—'}
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' as const }}>
                    <button type="button" style={isExpanded ? S.btnPri : S.btnSmall} onClick={() => toggleExpanded(r.id)}>
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                  </td>
                  <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={S.btnDanger} onClick={() => handleDeleteOne(r.id)}>Delete</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!sel && runs.length > 0 && <div style={{ color: '#8b949e', fontSize: 13 }}>seleziona un run dalla tabella per vedere i dettagli</div>}
      {sel && (
        <>
          <div style={S.card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Equity Curve {sel ? `#${sel}` : ''}</div>
            <div ref={chartRef} style={{ width: '100%', height: 260 }} />
          </div>
          <div style={S.card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Drawdown (%)</div>
            <div ref={ddRef} style={{ width: '100%', height: 160 }} />
          </div>
          {stats && groupedMetrics && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Metrics</div>
              <table style={S.table}>
                {groupedMetrics.otherRows.length > 0 && (
                  <tbody>
                    <tr>
                      <td colSpan={2} style={{ ...S.td, background: '#161b22', padding: 4 }}>
                        <button type="button" style={S.btnSmall} onClick={() => setCollapsed((s) => ({ ...s, _other: !s._other }))}>
                          {collapsed._other ? '▶' : '▼'} Altro ({groupedMetrics.otherRows.length})
                        </button>
                      </td>
                    </tr>
                    {!collapsed._other && groupedMetrics.otherRows.map(([k, v]) => (
                      <tr key={k}>
                        <td style={S.td}>{k}</td>
                        <td style={S.td} title={typeof v === 'number' ? String(v) : undefined}>{formatMetric(k, v)}</td>
                      </tr>
                    ))}
                  </tbody>
                )}
                {groupedMetrics.groups.map((g) => (
                  <tbody key={g.id}>
                    <tr>
                      <td colSpan={2} style={{ ...S.td, background: '#161b22', padding: 4 }}>
                        <button type="button" style={S.btnSmall} onClick={() => setCollapsed((s) => ({ ...s, [g.id]: !s[g.id] }))}>
                          {collapsed[g.id] ? '▶' : '▼'} {g.label} ({g.rows.length})
                        </button>
                      </td>
                    </tr>
                    {!collapsed[g.id] && g.rows.map(([k, v]) => (
                      <tr key={k}>
                        <td style={S.td}>{k}</td>
                        <td style={S.td} title={typeof v === 'number' ? String(v) : undefined}>{formatMetric(k, v)}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {tx.length > 0 && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Transactions (first 20)</div>
              <table style={S.table}>
                <thead>
                  <tr>
                    {Object.keys(tx[0] ?? {}).map((k) => (
                      <th key={k} style={S.th}>
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tx.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} style={S.td}>
                          {String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
