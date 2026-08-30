import { useCallback, useEffect, useState } from 'react'
import { backtestApi, type RunRow } from '../api/bt'

export function useRunsTable() {
  const [runs, setRuns] = useState<RunRow[]>([])
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
  const [msg, setMsg] = useState('')

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

  useEffect(() => { refresh() }, [refresh])

  const hasRunning = runs.some((r) => r.stats == null)
  useEffect(() => {
    if (!hasRunning) return
    const t = setInterval(() => refresh(), 1500)
    return () => clearInterval(t)
  }, [hasRunning, refresh])

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
    if (!window.confirm(`Eliminare run #${id}?`)) return false
    try {
      await backtestApi.deleteRun(id)
      setMsg(`[ok] eliminato run #${id}`)
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      refresh()
      return true
    } catch (e) { setMsg(`[err] ${String(e)}`); return false }
  }
  const handleBulkDelete = async () => {
    if (selected.size === 0) return new Set<number>()
    if (!window.confirm(`Eliminare ${selected.size} run selezionati?`)) return new Set<number>()
    try {
      const r = await backtestApi.bulkDeleteRuns([...selected])
      setMsg(`[ok] eliminati ${r.deleted} run`)
      const deleted = new Set(selected)
      setSelected(new Set())
      refresh()
      return deleted
    } catch (e) { setMsg(`[err] ${String(e)}`); return new Set<number>() }
  }
  const resetFilters = () => {
    setSearch(''); setSearchDraft('')
    setFId(''); setFStrategyName(''); setFCreatedAt(''); setFStart(''); setFEnd(''); setFTotalReturn(''); setFMaxDrawdown(''); setFSharpe(''); setFSortino(''); setFStats('')
    setSortBy(null); setSortDir('asc')
  }
  const allChecked = runs.length > 0 && runs.every((r) => selected.has(r.id))
  const hasFilter = Boolean(search || sortBy || fId || fStrategyName || fCreatedAt || fStart || fEnd || fTotalReturn || fMaxDrawdown || fSharpe || fSortino || fStats)

  return { runs, search, setSearch, searchDraft, setSearchDraft, sortBy, sortDir, fId, setFId, fStrategyName, setFStrategyName, fCreatedAt, setFCreatedAt, fStart, setFStart, fEnd, setFEnd, fTotalReturn, setFTotalReturn, fMaxDrawdown, setFMaxDrawdown, fSharpe, setFSharpe, fSortino, setFSortino, fStats, setFStats, selected, setSelected, msg, setMsg, refresh, hasRunning, handleSort, sortIcon, toggleOne, toggleAll, handleDeleteOne, handleBulkDelete, resetFilters, allChecked, hasFilter }
}
