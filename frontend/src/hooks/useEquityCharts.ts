import { useEffect, useRef } from 'react'
import { createChart, LineSeries, AreaSeries, LineStyle } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts'
import type { BenchmarkEquity } from '../api/bt'

function toTime(s: string): number {
  const t = Date.parse(s)
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000)
}
function sanitizeLine(dates: string[], values: (number | null | undefined)[]) {
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

function extractTicker(key: string): string {
  if (!key.includes('>')) return ''
  const parts = key.split('>')
  return parts[parts.length - 1].trim()
}

function segmentByHolding(
  dates: string[],
  values: number[],
  weights: { dates: string[]; series: Record<string, number[]> },
): { time: number; value: number; ticker: string }[] {
  const out: { time: number; value: number; ticker: string }[] = []
  const { dates: wDates, series } = weights
  const dominant: Map<number, string> = new Map()
  const wLen = wDates.length
  for (let i = 0; i < wLen; i++) {
    let bestTicker = ''
    let bestWeight = 0
    for (const [key, wArr] of Object.entries(series)) {
      if (!key.includes('>')) continue
      const w = wArr[i]
      if (w != null && w > bestWeight) {
        bestWeight = w
        bestTicker = extractTicker(key)
      }
    }
    if (bestTicker) dominant.set(i, bestTicker)
  }
  for (let i = 0; i < dates.length; i++) {
    const t = toTime(dates[i] ?? '')
    if (!t || !values[i]) continue
    const ticker = dominant.get(i) ?? ''
    out.push({ time: t, value: values[i]!, ticker })
  }
  return out
}

function splitSegments(data: { time: number; value: number; ticker: string }[]) {
  const segments: { ticker: string; points: { time: number; value: number }[] }[] = []
  let cur: typeof segments[0] | null = null
  for (const d of data) {
    if (!cur || cur.ticker !== d.ticker) {
      cur = { ticker: d.ticker, points: [] }
      segments.push(cur)
    }
    cur.points.push({ time: d.time, value: d.value })
  }
  return segments
}

const COLORS = {
  spy: '#58a6ff',
  sector: '#ffffff',
}

export function useEquityCharts(
  prices: { dates: string[]; values: number[] } | null,
  benchmark?: BenchmarkEquity | null,
  weights?: { dates: string[]; series: Record<string, number[]> } | null,
  /** Optional ref to store eq timeScale for cross-chart sync. */
  eqTimeScaleRef?: { current: ReturnType<IChartApi['timeScale']> | null },
  /** Optional ref to store dd timeScale for cross-chart sync. */
  ddTimeScaleRef?: { current: ReturnType<IChartApi['timeScale']> | null },
) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const ddRef = useRef<HTMLDivElement | null>(null)
  const eqChartRef = useRef<IChartApi | null>(null)
  const ddChartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartRef.current || !ddRef.current || !prices || prices.dates.length === 0) return
    const eqEl = chartRef.current
    const ddEl = ddRef.current
    const eqChart: IChartApi = createChart(eqEl, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      width: eqEl.clientWidth,
      height: 260,
      grid: { vertLines: { color: '#21262d' }, horzLines: { visible: false } },
      crosshair: { mode: 2, vertLine: { visible: false }, horzLine: { visible: false } },
    })
    const ddChart: IChartApi = createChart(ddEl, {
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      width: ddEl.clientWidth,
      height: 160,
      grid: { vertLines: { color: '#21262d' }, horzLines: { visible: false } },
      crosshair: { mode: 2, vertLine: { visible: false }, horzLine: { visible: false } },
    })
    eqChartRef.current = eqChart
    ddChartRef.current = ddChart
    // expose timeScales for cross-chart sync
    if (eqTimeScaleRef) eqTimeScaleRef.current = eqChart.timeScale()
    if (ddTimeScaleRef) ddTimeScaleRef.current = ddChart.timeScale()

    const eqData = sanitizeLine(prices.dates, prices.values)
    let segSeries: ISeriesApi<'Line'>[] = []
    if (weights && Object.keys(weights.series).length > 0) {
      const segmented = segmentByHolding(prices.dates, prices.values, weights)
      for (const seg of splitSegments(segmented)) {
        const color = seg.ticker === 'SPY' ? COLORS.spy : COLORS.sector
        const s = eqChart.addSeries(LineSeries, { color, lineWidth: 2, title: seg.ticker, priceLineVisible: false })
        s.setData(seg.points as never)
        segSeries.push(s)
      }
    } else {
      const s = eqChart.addSeries(LineSeries, { color: COLORS.spy, lineWidth: 2, title: 'strategy', priceLineVisible: false })
      s.setData(eqData as never)
      segSeries = [s]
    }

    const ddSeries: ISeriesApi<'Area'> = ddChart.addSeries(AreaSeries, {
      lineColor: '#f85149',
      topColor: 'rgba(248,81,73,0.4)',
      bottomColor: 'rgba(248,81,73,0.0)',
    })
    const ddData = buildDrawdown(prices.values, prices.dates)
    ddSeries.setData(ddData as never)

    if (benchmark && benchmark.values.length > 0) {
      const bSeries = eqChart.addSeries(LineSeries, {
        color: '#d29922',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        title: benchmark.ticker,
        priceLineVisible: false,
      })
      bSeries.setData(sanitizeLine(benchmark.dates, benchmark.values) as never)
    }

    eqChart.timeScale().fitContent()
    ddChart.timeScale().fitContent()

    const eqMap = new Map<number, number>(eqData.map((d) => [d.time, d.value]))
    const ddMap = new Map<number, number>(ddData.map((d) => [d.time, d.value]))

    let syncing = false
    const eqTS = eqChart.timeScale()
    const ddTS = ddChart.timeScale()

    const onEqLogical = (range: { from: number; to: number } | null) => {
      if (syncing || !range) return
      syncing = true
      try { ddTS.setVisibleLogicalRange(range) } catch { /* ignore */ }
      syncing = false
    }
    const onDdLogical = (range: { from: number; to: number } | null) => {
      if (syncing || !range) return
      syncing = true
      try { eqTS.setVisibleLogicalRange(range) } catch { /* ignore */ }
      syncing = false
    }
    eqTS.subscribeVisibleLogicalRangeChange(onEqLogical)
    ddTS.subscribeVisibleLogicalRangeChange(onDdLogical)

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
      try { eqChart.setCrosshairPosition(price, param.time, segSeries[segSeries.length - 1]!) } catch { /* ignore */ }
      syncing = false
    }
    eqChart.subscribeCrosshairMove(onEqCrosshair)
    ddChart.subscribeCrosshairMove(onDdCrosshair)

    const roEq = new ResizeObserver(() => eqChart.applyOptions({ width: eqEl.clientWidth }))
    const roDd = new ResizeObserver(() => ddChart.applyOptions({ width: ddEl.clientWidth }))
    roEq.observe(eqEl)
    roDd.observe(ddEl)

    return () => {
      try { eqTS.unsubscribeVisibleLogicalRangeChange(onEqLogical) } catch { /* ignore */ }
      try { ddTS.unsubscribeVisibleLogicalRangeChange(onDdLogical) } catch { /* ignore */ }
      try { eqChart.unsubscribeCrosshairMove(onEqCrosshair) } catch { /* ignore */ }
      try { ddChart.unsubscribeCrosshairMove(onDdCrosshair) } catch { /* ignore */ }
      roEq.disconnect()
      roDd.disconnect()
      for (const s of segSeries) try { eqChart.removeSeries(s) } catch { /* ignore */ }
      try { eqChart.remove() } catch { /* ignore */ }
      try { ddChart.remove() } catch { /* ignore */ }
      eqChartRef.current = null
      ddChartRef.current = null
      if (eqTimeScaleRef) eqTimeScaleRef.current = null
      if (ddTimeScaleRef) ddTimeScaleRef.current = null
    }
  }, [prices, benchmark, weights, eqTimeScaleRef, ddTimeScaleRef])

  return { chartRef, ddRef }
}
