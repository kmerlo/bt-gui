import { useCallback, useEffect, useState } from 'react'
import { backtestApi, type BenchmarkEquity, type BenchmarkStats } from '../api/bt'

export function useRunDetail(runId: number | null) {
  const [sel, setSel] = useState<number | null>(runId)
  const [prices, setPrices] = useState<{ dates: string[]; values: number[] } | null>(null)
  const [weights, setWeights] = useState<{ dates: string[]; series: Record<string, number[]> } | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [benchmark, setBenchmark] = useState<BenchmarkEquity | null>(null)
  const [benchmarkTicker, setBenchmarkTicker] = useState<string | null>(null)
  const [benchmarkStats, setBenchmarkStats] = useState<BenchmarkStats | null>(null)
  const [tx, setTx] = useState<Record<string, unknown>[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [runStart, setRunStart] = useState<string | null>(null)
  const [runEnd, setRunEnd] = useState<string | null>(null)

  useEffect(() => { setSel(runId) }, [runId])

  const loadDetail = useCallback((id: number) => {
    backtestApi.getRun(id).then((r) => {
      setStats((r.stats as Record<string, unknown>) ?? null)
      setTx((r.transactions as Record<string, unknown>[]) ?? [])
      setRunStart((r.config as Record<string, unknown>)?.start as string | null)
      setRunEnd((r.config as Record<string, unknown>)?.end as string | null)
      const bt = (r.benchmark_ticker as string | null) ?? ((r.config as Record<string, unknown>)?.benchmark_ticker as string | null) ?? null
      setBenchmarkTicker(bt)
      setBenchmarkStats((r.benchmark as BenchmarkStats | null) ?? null)
      backtestApi.getPrices(id, { start: runStart ?? undefined, end: runEnd ?? undefined, limit: 20000, benchmark_ticker: bt ?? undefined }).then((d) => {
        setPrices({ dates: d.dates, values: d.values })
        setBenchmark(d.benchmark ?? null)
        const w = d.weights as Record<string, number[]> | undefined
        if (w && Object.keys(w).length > 0) setWeights({ dates: d.dates, series: w })
        else setWeights(null)
      }).catch(() => { /* ignore */ })
    }).catch(() => { /* ignore */ })
  }, [runStart, runEnd])

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (sel === id) { setSel(null); setStats(null); setPrices(null); setWeights(null); setTx([]); setBenchmark(null); setBenchmarkTicker(null); setBenchmarkStats(null) }
      } else {
        next.add(id)
        setSel(id)
        loadDetail(id)
      }
      return next
    })
  }, [sel, loadDetail])

  useEffect(() => {
    if (sel == null) return
    loadDetail(sel)
  }, [sel, loadDetail])

  const clearIfDeleted = useCallback((deletedIds: Set<number>) => {
    if (sel !== null && deletedIds.has(sel)) { setSel(null); setStats(null); setPrices(null); setWeights(null); setTx([]); setBenchmark(null); setBenchmarkTicker(null); setBenchmarkStats(null) }
    setExpanded((prev) => { const n = new Set(prev); for (const id of deletedIds) n.delete(id); return n })
  }, [sel])

  const clearSel = useCallback(() => { setSel(null); setStats(null); setPrices(null); setWeights(null); setTx([]); setBenchmark(null); setBenchmarkTicker(null); setBenchmarkStats(null) }, [])

  return { sel, setSel, prices, weights, stats, tx, benchmark, benchmarkTicker, benchmarkStats, expanded, setExpanded, loadDetail, toggleExpanded, clearIfDeleted, clearSel }
}
