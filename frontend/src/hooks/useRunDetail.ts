import { useCallback, useEffect, useState } from 'react'
import { backtestApi } from '../api/bt'

export function useRunDetail(runId: number | null) {
  const [sel, setSel] = useState<number | null>(runId)
  const [prices, setPrices] = useState<{ dates: string[]; values: number[] } | null>(null)
  const [stats, setStats] = useState<Record<string, unknown> | null>(null)
  const [tx, setTx] = useState<Record<string, unknown>[]>([])
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => { setSel(runId) }, [runId])

  const loadDetail = useCallback((id: number) => {
    backtestApi.getRun(id).then((r) => {
      setStats((r.stats as Record<string, unknown>) ?? null)
      setTx((r.transactions as Record<string, unknown>[]) ?? [])
    }).catch(() => { /* ignore */ })
    backtestApi.getPrices(id).then(setPrices).catch(() => { /* ignore */ })
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

  useEffect(() => {
    if (sel == null) return
    loadDetail(sel)
  }, [sel, loadDetail])

  const clearIfDeleted = useCallback((deletedIds: Set<number>) => {
    if (sel !== null && deletedIds.has(sel)) { setSel(null); setStats(null); setPrices(null); setTx([]) }
    setExpanded((prev) => { const n = new Set(prev); for (const id of deletedIds) n.delete(id); return n })
  }, [sel])

  const clearSel = useCallback(() => { setSel(null); setStats(null); setPrices(null); setTx([]) }, [])

  return { sel, setSel, prices, stats, tx, expanded, setExpanded, loadDetail, toggleExpanded, clearIfDeleted, clearSel }
}
