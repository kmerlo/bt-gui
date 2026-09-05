import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import type { IChartApi } from 'lightweight-charts'
import { backtestApi } from '../api/bt'

const PALETTE = ['#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff', '#ff7b72', '#79c0ff', '#ffa657']

function toTime(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}

export type CompareSeries = { id: number; name: string; dates: string[]; values: number[] }

function normalizeTo100(values: number[]): number[] {
  if (values.length === 0) return []
  // first non-zero value as base
  let base = 0
  for (const v of values) {
    if (v != null && Number.isFinite(v) && v !== 0) { base = v; break }
  }
  if (!base) return values.map(() => 0)
  return values.map((v) => (v / base) * 100)
}

export function useCompareCharts() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [series, setSeries] = useState<CompareSeries[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (ids: number[], namesById: Record<number, string>) => {
    if (ids.length === 0) { setSeries([]); return }
    setLoading(true)
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const d = await backtestApi.getPrices(id, { limit: 20000 })
        return { id, name: namesById[id] ?? `#${id}`, dates: d.dates, values: normalizeTo100(d.values) } as CompareSeries
      }))
      setSeries(results)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  const clear = useCallback(() => setSeries([]), [])

  useEffect(() => {
    if (!ref.current || series.length === 0) return
    const el = ref.current
    const chart: IChartApi = createChart(el, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      width: el.clientWidth,
      height: 260,
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
    })
    series.forEach((s, i) => {
      const ls = chart.addSeries(LineSeries, { color: PALETTE[i % PALETTE.length], lineWidth: 2, title: s.name })
      const data: { time: number; value: number }[] = []
      for (let j = 0; j < s.dates.length; j++) {
        const v = s.values[j]
        if (v == null || Number.isNaN(v)) continue
        const time = toTime(s.dates[j] ?? '')
        if (!time) continue
        data.push({ time, value: v })
      }
      ls.setData(data as never)
    })
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => { ro.disconnect(); chart.remove() }
  }, [series])

  return { ref, series, loading, load, clear }
}
