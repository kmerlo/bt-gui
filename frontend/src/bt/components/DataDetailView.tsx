import { useEffect, useState, useCallback } from 'react'
import { dataApi, type DataSourceRow } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: '6px 8px', background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thCb: { border: '1px solid #30363d', padding: '6px 8px', background: '#161b22', textAlign: 'center' as const, position: 'sticky' as const, top: 0, zIndex: 1, width: 36 } as const,
  td: { border: '1px solid #30363d', padding: '6px 8px', whiteSpace: 'nowrap' as const } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnDangerDis: { background: '#21262d', color: '#484f58', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'not-allowed', fontSize: 12 } as const,
  btnDis: { background: '#21262d', color: '#484f58', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'not-allowed' } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
}

type TableResp = { columns: string[]; rows: Record<string, unknown>[]; total: number; shape: number[]; filtered_shape: number[]; offset: number; limit: number }

export default function DataDetailView() {
  const [sources, setSources] = useState<DataSourceRow[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [data, setData] = useState<TableResp | null>(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [sortBy, setSortBy] = useState<string | null>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    dataApi.list().then(setSources).catch((e: unknown) => setMsg(String(e)))
  }, [])

  useEffect(() => { setPage(0) }, [selectedId, search, sortBy, sortDir, pageSize])
  useEffect(() => { setSelected(new Set()) }, [selectedId, search, sortBy, page, pageSize])

  const fetchTable = useCallback(async () => {
    if (selectedId === null) return
    setLoading(true)
    setMsg('')
    try {
      const res = await dataApi.table(selectedId, {
        limit: pageSize,
        offset: page * pageSize,
        sort_by: sortBy ?? undefined,
        sort_dir: sortDir,
        search: search || undefined,
      })
      setData(res)
    } catch (e) {
      setMsg(String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedId, page, pageSize, sortBy, sortDir, search])

  useEffect(() => { void fetchTable() }, [fetchTable])

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir(col === 'date' ? 'desc' : 'asc')
    }
  }

  const rowDate = (row: Record<string, unknown>) => String(row['date'] ?? '')

  const toggleOne = (date: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(date)) n.delete(date)
      else n.add(date)
      return n
    })
  }

  const toggleAll = (checked: boolean) => {
    if (!data) return
    if (checked) {
      setSelected(new Set(data.rows.map(rowDate).filter(Boolean)))
    } else {
      setSelected(new Set())
    }
  }

  const handleDeleteOne = async (date: string) => {
    if (selectedId === null) return
    if (!window.confirm(`Eliminare la riga ${date}?`)) return
    setDeleting(true)
    try {
      const r = await dataApi.deleteRows(selectedId, [date])
      setMsg(`[ok] eliminata ${date} — rimaste ${r.remaining} righe`)
      await fetchTable()
      setSelected((prev) => { const n = new Set(prev); n.delete(date); return n })
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    } finally {
      setDeleting(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedId === null || selected.size === 0) return
    const dates = [...selected]
    if (!window.confirm(`Eliminare ${dates.length} righe selezionate?`)) return
    setDeleting(true)
    try {
      const r = await dataApi.deleteRows(selectedId, dates)
      setMsg(`[ok] eliminate ${r.deleted} righe — rimaste ${r.remaining}`)
      setSelected(new Set())
      // if page became empty and not first page, go back
      if (r.remaining <= page * pageSize && page > 0) setPage((p) => Math.max(0, p - 1))
      else await fetchTable()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0
  const allPageSelected = data ? data.rows.length > 0 && data.rows.every((r) => selected.has(rowDate(r))) : false

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Dettaglio Data</h3>
      <div style={S.row}>
        <select
          style={{ ...S.input, minWidth: 220 }}
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">— seleziona datasource —</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name} (id:{s.id} · {s.type} · {s.source})</option>
          ))}
        </select>
        <input
          style={S.input}
          placeholder="cerca (filtro globale)"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchDraft) }}
        />
        <button type="button" style={S.btn} onClick={() => setSearch(searchDraft)}>Filtra</button>
        {(search || sortBy !== 'date' || sortDir !== 'desc') && (
          <button type="button" style={S.btn} onClick={() => { setSearch(''); setSearchDraft(''); setSortBy('date'); setSortDir('desc') }}>Reset</button>
        )}
        <select style={S.input} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
          <option value={25}>25 / pagina</option>
          <option value={50}>50 / pagina</option>
          <option value={100}>100 / pagina</option>
        </select>
      </div>

      {selectedId === null && <div style={{ fontSize: 13, color: '#8b949e' }}>Seleziona un datasource per visualizzare i dati in forma tabellare.</div>}
      {msg && <div style={msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{msg}</div>}
      {loading && <div style={{ fontSize: 12, color: '#8b949e' }}>caricamento…</div>}

      {data && selectedId !== null && (
        <>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
            {data.total} righe totali{search ? ` (filtrate su ${data.shape[0]} originali)` : ''} · {data.columns.length} colonne · pagina {page + 1} / {Math.max(totalPages, 1)}
            {selected.size > 0 && ` · selezionate: ${selected.size}`}
          </div>
          {selected.size > 0 && (
            <div style={{ ...S.row, marginBottom: 8 }}>
              <button type="button" style={deleting ? S.btnDangerDis : S.btnDanger} disabled={deleting} onClick={handleBulkDelete}>
                Elimina selezionate ({selected.size})
              </button>
              <button type="button" style={S.btn} onClick={() => setSelected(new Set())}>Deseleziona</button>
            </div>
          )}
          <div style={{ overflow: 'auto', maxHeight: '55vh', border: '1px solid #30363d', borderRadius: 6 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thCb}>
                    <input type="checkbox" checked={allPageSelected} onChange={(e) => toggleAll(e.target.checked)} title="Seleziona tutti (pagina corrente)" />
                  </th>
                  <th style={S.th} onClick={() => handleSort('date')}>
                    date {sortBy === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                  </th>
                  {data.columns.map((c) => (
                    <th key={c} style={S.th} onClick={() => handleSort(c)}>
                      {c} {sortBy === c ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </th>
                  ))}
                  <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Delete</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr><td style={S.td} colSpan={data.columns.length + 3}>nessun dato</td></tr>
                ) : data.rows.map((row, i) => {
                  const d = rowDate(row)
                  return (
                    <tr key={`${d}-${i}`}>
                      <td style={{ ...S.td, textAlign: 'center' as const }}>
                        <input type="checkbox" checked={selected.has(d)} onChange={() => toggleOne(d)} />
                      </td>
                      <td style={S.td}>{d}</td>
                      {data.columns.map((c) => (
                        <td key={c} style={S.td}>{row[c] === null || row[c] === undefined ? '' : String(row[c])}</td>
                      ))}
                      <td style={{ ...S.td, textAlign: 'center' as const }}>
                        <button type="button" style={deleting ? S.btnDangerDis : S.btnDanger} disabled={deleting} onClick={() => handleDeleteOne(d)}>Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ ...S.row, marginTop: 10 }}>
            <button type="button" style={page === 0 ? S.btnDis : S.btn} disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 13 }}>pag. {page + 1} / {Math.max(totalPages, 1)}</span>
            <button type="button" style={page + 1 >= totalPages ? S.btnDis : S.btn} disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next ›</button>
          </div>
        </>
      )}
    </div>
  )
}
