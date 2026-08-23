import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, AreaSeries } from 'lightweight-charts'
import { backtestApi, type RunRow } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' } as const,
  td: { border: '1px solid #30363d', padding: 6 } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
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

export default function ResultsDashboard({ runId }: { runId: number | null }) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [sel, setSel] = useState<number | null>(runId)
  const [prices, setPrices] = useState<{ dates: string[]; values: number[] } | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [tx, setTx] = useState<Record<string, unknown>[]>([])
  const chartRef = useRef<HTMLDivElement | null>(null)
  const ddRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setSel(runId)
  }, [runId])

  useEffect(() => {
    backtestApi
      .listRuns()
      .then(setRuns)
      .catch(() => {
        /* ignore */
      })
  }, [])

  useEffect(() => {
    if (sel == null) return
    backtestApi
      .getRun(sel)
      .then((r) => {
        setStats((r.stats as Record<string, unknown>) ?? null)
        setTx((r.transactions as Record<string, unknown>[]) ?? [])
      })
      .catch(() => {
        /* ignore */
      })
    backtestApi
      .getPrices(sel)
      .then(setPrices)
      .catch(() => {
        /* ignore */
      })
  }, [sel])

  // equity chart
  useEffect(() => {
    if (!chartRef.current || !prices || prices.dates.length === 0) return
    const el = chartRef.current
    const chart = createChart(el, { layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' }, width: el.clientWidth, height: 260, grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } } })
    const series = chart.addSeries(LineSeries, { color: '#58a6ff', lineWidth: 2 })
    series.setData(sanitizeLine(prices.dates, prices.values) as never)
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [prices])

  // drawdown chart
  useEffect(() => {
    if (!ddRef.current || !prices || prices.dates.length === 0) return
    const el = ddRef.current
    const chart = createChart(el, { layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' }, width: el.clientWidth, height: 160, grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } } })
    const series = chart.addSeries(AreaSeries, { lineColor: '#f85149', topColor: 'rgba(248,81,73,0.4)', bottomColor: 'rgba(248,81,73,0.0)' })
    series.setData(buildDrawdown(prices.values, prices.dates) as never)
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [prices])

  if (sel == null && runs.length === 0) return <div style={S.wrap}>no runs yet — run a backtest from Builder</div>

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#8b949e' }}>run</span>
        <select style={S.input} value={sel ?? ''} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— select —</option>
          {runs.map((r) => (
            <option key={r.id} value={String(r.id)}>
              #{r.id} {r.stats ? JSON.stringify(r.stats).slice(0, 40) : 'running'}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={S.btn}
          onClick={() => backtestApi.listRuns().then(setRuns).catch(() => {})}
        >
          refresh
        </button>
      </div>
      {!sel && <div style={{ color: '#8b949e', fontSize: 13 }}>select a run to view results</div>}
      {sel && (
        <>
          <div style={S.card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Equity Curve</div>
            <div ref={chartRef} style={{ width: '100%', height: 260 }} />
          </div>
          <div style={S.card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Drawdown (%)</div>
            <div ref={ddRef} style={{ width: '100%', height: 160 }} />
          </div>
          {stats && (
            <div style={S.card}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Metrics</div>
              <table style={S.table}>
                <tbody>
                  {Object.entries(stats).map(([k, v]) => (
                    <tr key={k}>
                      <td style={S.td}>{k}</td>
                      <td style={S.td}>{typeof v === 'number' ? v.toFixed(4) : String(v).slice(0, 120)}</td>
                    </tr>
                  ))}
                </tbody>
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
