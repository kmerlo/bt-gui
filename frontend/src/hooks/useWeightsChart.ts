import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, LineSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'

const PALETTE = ['#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff', '#ff7b72', '#79c0ff', '#ffa657']

function toTime(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}

export function useWeightsChart(weights: { dates: string[]; series: Record<string, number[]> } | null) {
  const ref = useRef<HTMLDivElement | null>(null)
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const keys = useMemo(() => {
    if (!weights) return [] as string[]
    return Object.keys(weights.series).filter((k) => k !== 'price')
  }, [weights])

  // reset hidden when weights identity changes
  useEffect(() => { setHidden(new Set()) }, [weights])

  const toggle = useCallback((k: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  const showAll = useCallback(() => setHidden(new Set()), [])
  const hideAll = useCallback(() => setHidden(new Set(keys)), [keys])

  useEffect(() => {
    if (!ref.current || !weights || weights.dates.length === 0) return
    const el = ref.current
    const ks = Object.keys(weights.series).filter((k) => k !== 'price')
    if (ks.length === 0) return
    const chart: IChartApi = createChart(el, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      width: el.clientWidth,
      height: 200,
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      rightPriceScale: { scaleMargins: { top: 0.05, bottom: 0.05 } },
    })
    const map = new Map<string, ISeriesApi<'Line'>>()
    ks.forEach((k, i) => {
      const s = chart.addSeries(LineSeries, { color: PALETTE[i % PALETTE.length], lineWidth: 2, title: k, priceLineVisible: false })
      const vals = weights.series[k] ?? []
      const data: { time: number; value: number }[] = []
      for (let j = 0; j < weights.dates.length; j++) {
        const v = vals[j]
        if (v == null || Number.isNaN(v as number)) continue
        const time = toTime(weights.dates[j] ?? '')
        if (!time) continue
        const pct = (v as number) * 100
        data.push({ time, value: pct })
      }
      s.setData(data as never)
      map.set(k, s)
    })
    seriesMapRef.current = map
    chart.timeScale().fitContent()
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }))
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      seriesMapRef.current = new Map()
    }
  }, [weights])

  // apply visibility when hidden changes
  useEffect(() => {
    for (const [k, s] of seriesMapRef.current) {
      s.applyOptions({ visible: !hidden.has(k) })
    }
  }, [hidden])

  return { ref, keys, hidden, toggle, showAll, hideAll, palette: PALETTE }
}
