import { useEffect, useRef } from 'react'
import { createChart, LineSeries, AreaSeries } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts'

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

export function useEquityCharts(prices: { dates: string[]; values: number[] } | null) {
  const chartRef = useRef<HTMLDivElement | null>(null)
  const ddRef = useRef<HTMLDivElement | null>(null)

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

  return { chartRef, ddRef }
}
