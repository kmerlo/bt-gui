import { useCallback, useEffect, useMemo, useState } from 'react'
import { dataApi, type DataSourceRow } from '../../api/bt'
import { applySearch, applySort } from '../../utils/listQuery'

const PAGE_SIZES = [25, 50, 100] as const

type SortState = { by: string | null; dir: 'asc' | 'desc' }
type FilterState = Record<string, string>

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: '4px 8px', background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thActive: { border: '1px solid #58a6ff', padding: '4px 8px', background: '#1f2b3a', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  td: { border: '1px solid #30363d', padding: '4px 8px', whiteSpace: 'nowrap' as const } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnView: { background: '#1f6feb', color: '#fff', border: '1px solid #1f6feb', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } as const,
  msg: { fontSize: 12, color: '#8b949e' } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
}

const COLUMNS: { key: keyof DataSourceRow; label: string }[] = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'source', label: 'Source' },
  { key: 'path_or_tickers', label: 'Tickers' },
]

export default function SignalsView() {
  const [signals, setSignals] = useState<DataSourceRow[]>([])
  const [sort, setSort] = useState<SortState>({ by: null, dir: 'asc' })
  const [filters, setFilters] = useState<FilterState>({})
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(() => {
    dataApi.listSignals().then((data) => {
      setSignals(data)
      setMsg('')
    }).catch((e: unknown) => {
      setMsg(String(e))
    })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const sortedFiltered = useMemo(() => {
    let list = [...signals]
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue
      list = applySearch(list, val, [key as keyof DataSourceRow])
    }
    if (sort.by) list = applySort(list, sort.by, sort.dir)
    return list
  }, [signals, sort, filters])

  const paged = useMemo(() => {
    const start = page * pageSize
    return sortedFiltered.slice(start, start + pageSize)
  }, [sortedFiltered, page, pageSize])

  const totalPages = Math.ceil(sortedFiltered.length / pageSize)

  const handleSort = (key: string) => {
    setSort((prev) => ({
      by: key,
      dir: prev.by === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc',
    }))
  }

  const handleFilter = (key: string, val: string) => {
    setFilters((prev) => ({ ...prev, [key]: val }))
    setPage(0)
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm(`Eliminare signal #${id}?`)) return
    try {
      await dataApi.deleteSignal(id)
      refresh()
    } catch (e) {
      setMsg(String(e))
    }
  }

  const sortIcon = (key: string) => {
    if (sort.by !== key) return ' ↕'
    return sort.dir === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Signals</h3>
      {msg && <div style={S.msgErr}>{msg}</div>}
      <div style={S.row}>
        <select style={{ ...S.btn, background: '#0d1117' }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pagina</option>)}
        </select>
        <span style={S.msg}>{signals.length} total · pag. {page + 1} / {totalPages}</span>
      </div>
      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #30363d', borderRadius: 6 }}>
        <table style={S.table}>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} style={sort.by === col.key ? S.thActive : S.th} onClick={() => handleSort(col.key)}>
                  {col.label}{sortIcon(col.key)}
                </th>
              ))}
              <th style={{ ...S.th, minWidth: 120 }}>Azioni</th>
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th key={`f-${col.key}`} style={{ border: '1px solid #30363d', padding: '2px 4px', background: '#0d1117', whiteSpace: 'nowrap' }}>
                  <input
                    style={{ background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '2px 4px', fontSize: 11, width: '100%', boxSizing: 'border-box' }}
                    placeholder="filter…"
                    value={filters[col.key] ?? ''}
                    onChange={(e) => handleFilter(col.key, e.target.value)}
                  />
                </th>
              ))}
              <th style={{ border: '1px solid #30363d', padding: '2px 4px', background: '#0d1117' }} />
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.length === 0 ? (
              <tr><td style={S.td} colSpan={5}>Nessun signal salvato</td></tr>
            ) : paged.map((sig) => (
              <tr key={sig.id}>
                <td style={{ ...S.td, fontWeight: 600 }}>#{sig.id}</td>
                <td style={S.td}>{sig.name}</td>
                <td style={S.td}>{sig.source}</td>
                <td style={S.td}>{sig.path_or_tickers}</td>
                <td style={{ ...S.td, display: 'flex', gap: 4 }}>
                  <button type="button" style={S.btnView} onClick={() => {
                    window.dispatchEvent(new CustomEvent('bt-navigate-signal', { detail: sig.id }))
                  }}>View</button>
                  <button type="button" style={S.btnDanger} onClick={() => handleDelete(sig.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ ...S.row, marginTop: 8 }}>
          <button type="button" style={page === 0 ? { ...S.btn, opacity: 0.5 } : S.btn} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
          <span style={S.msg}>pag. {page + 1} / {totalPages}</span>
          <button type="button" style={page + 1 >= totalPages ? { ...S.btn, opacity: 0.5 } : S.btn} disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
        </div>
      )}
    </div>
  )
}
