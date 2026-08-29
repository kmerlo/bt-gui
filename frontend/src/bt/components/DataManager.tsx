import { useCallback, useEffect, useMemo, useState } from 'react'
import { dataApi, type DataSourceRow } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thCb: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'center' as const, position: 'sticky' as const, top: 0, zIndex: 1, width: 36 } as const,
  td: { border: '1px solid #30363d', padding: 6 } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
}

export default function DataManager() {
  const [rows, setRows] = useState<DataSourceRow[]>([])
  const [name, setName] = useState('')
  const [dtype, setDtype] = useState('price')
  const [file, setFile] = useState<File | null>(null)
  const [tickers, setTickers] = useState('AAPL,MSFT')
  const [start, setStart] = useState('2020-01-01')
  const [end, setEnd] = useState('2020-12-31')
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)
  const [previewSortDir, setPreviewSortDir] = useState<'asc' | 'desc'>('desc')
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const refresh = useCallback(() => {
    dataApi
      .list({ search: search || undefined, sort_by: sortBy ?? undefined, sort_dir: sortDir })
      .then((data) => {
        setRows(data)
        // prune selection: keep only ids still present
        setSelected((prev) => {
          const ids = new Set(data.map((r) => r.id))
          const n = new Set<number>()
          for (const id of prev) if (ids.has(id)) n.add(id)
          return n
        })
      })
      .catch((e: unknown) => setMsg(String(e)))
  }, [search, sortBy, sortDir])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('asc') }
  }

  const sortIcon = (col: string) => (sortBy === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕')

  const handleUpload = async () => {
    if (!file || !name) {
      setMsg('name + file required')
      return
    }
    try {
      await dataApi.upload(name, dtype, file)
      setMsg(`[ok] uploaded ${name}`)
      refresh()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    }
  }

  const handleFetch = async () => {
    const t = tickers
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!name.trim()) {
      setMsg(`name required (got "${name}")`)
      return
    }
    if (t.length === 0) {
      setMsg('tickers required (e.g. AAPL,MSFT)')
      return
    }
    try {
      const r = await dataApi.fetchFfn(name.trim(), dtype, t, start, end)
      const meta = r.meta as Record<string, unknown>
      const shape = meta.shape as number[] | undefined
      const n = shape ? String(shape[0]) : '?'
      setMsg(`[ok] fetched ${r.name}  (${n} rows)`)
      refresh()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    }
  }

  const handlePreview = async (id: number) => {
    try {
      const p = await dataApi.preview(id)
      setPreview({ columns: p.columns, rows: p.rows })
      setPreviewSortDir('desc')
    } catch (e) {
      setMsg(String(e))
    }
  }

  const previewRowsSorted = useMemo(() => {
    if (!preview) return []
    const rows = [...preview.rows]
    rows.sort((a, b) => {
      const da = String(a['date'] ?? '')
      const db = String(b['date'] ?? '')
      return previewSortDir === 'asc' ? da.localeCompare(db) : db.localeCompare(da)
    })
    return rows
  }, [preview, previewSortDir])

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(rows.map((r) => r.id)))
    else setSelected(new Set())
  }

  const handleDeleteOne = async (id: number, dname: string) => {
    if (!window.confirm(`Eliminare datasource "${dname}" (id:${id})?`)) return
    try {
      await dataApi.delete(id)
      setMsg(`[ok] eliminato ${dname}`)
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      refresh()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Eliminare ${selected.size} datasource selezionati?`)) return
    try {
      const ids = [...selected]
      const r = await dataApi.bulkDelete(ids)
      setMsg(`[ok] eliminati ${r.deleted} datasource`)
      setSelected(new Set())
      refresh()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    }
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Data Manager</h3>
      <div style={S.row}>
        <input style={S.input} placeholder="name *" value={name} onChange={(e) => setName(e.target.value)} />
        <select style={S.input} value={dtype} onChange={(e) => setDtype(e.target.value)}>
          <option value="price">price</option>
          <option value="volume">volume</option>
          <option value="volatility">volatility</option>
          <option value="bidoffer">bidoffer</option>
        </select>
        <input type="file" accept=".csv,.parquet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button type="button" style={S.btn} onClick={handleUpload}>
          Upload
        </button>
      </div>
      <div style={S.row}>
        <input style={S.input} placeholder="tickers AAPL,MSFT" value={tickers} onChange={(e) => setTickers(e.target.value)} />
        <input style={S.input} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <input style={S.input} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        <button type="button" style={S.btn} onClick={handleFetch}>
          Fetch FFN
        </button>
      </div>
      <div style={S.row}>
        <input
          style={S.input}
          placeholder="cerca (name/type/source)"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchDraft) }}
        />
        <button type="button" style={S.btn} onClick={() => setSearch(searchDraft)}>Filtra</button>
        {(search || sortBy) && (
          <button type="button" style={S.btn} onClick={() => { setSearch(''); setSearchDraft(''); setSortBy(null); setSortDir('asc') }}>Reset</button>
        )}
        <span style={{ fontSize: 12, color: '#8b949e' }}>{rows.length} sorgenti{search ? ' (filtrate)' : ''}{selected.size > 0 ? ` · selezionate: ${selected.size}` : ''}</span>
      </div>
      {selected.size > 0 && (
        <div style={{ ...S.row, marginBottom: 8 }}>
          <button type="button" style={S.btnDanger} onClick={handleBulkDelete}>Elimina selezionate ({selected.size})</button>
          <button type="button" style={S.btn} onClick={() => setSelected(new Set())}>Deseleziona</button>
        </div>
      )}
      {msg && <div style={msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{msg}</div>}
      <div style={{ overflow: 'auto', maxHeight: '55vh', border: '1px solid #30363d', borderRadius: 6 }}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.thCb}>
                <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} title="Seleziona tutti" />
              </th>
              <th style={S.th} onClick={() => handleSort('id')}>id{sortIcon('id')}</th>
              <th style={S.th} onClick={() => handleSort('name')}>name{sortIcon('name')}</th>
              <th style={S.th} onClick={() => handleSort('type')}>type{sortIcon('type')}</th>
              <th style={S.th} onClick={() => handleSort('source')}>source{sortIcon('source')}</th>
              <th style={{ ...S.th, cursor: 'default' }}>meta</th>
              <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>action</th>
              <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Delete</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td style={S.td} colSpan={8}>nessun datasource</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id}>
                <td style={{ ...S.td, textAlign: 'center' as const }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} />
                </td>
                <td style={S.td}>{r.id}</td>
                <td style={S.td}>{r.name}</td>
                <td style={S.td}>{r.type}</td>
                <td style={S.td}>{r.source}</td>
                <td style={S.td}>{JSON.stringify(r.meta)}</td>
                <td style={{ ...S.td, textAlign: 'center' as const }}>
                  <button type="button" style={S.btn} onClick={() => handlePreview(r.id)}>
                    preview
                  </button>
                </td>
                <td style={{ ...S.td, textAlign: 'center' as const }}>
                  <button type="button" style={S.btnDanger} onClick={() => handleDeleteOne(r.id, r.name)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>preview {preview.columns.join(', ')}</div>
          <div style={{ overflow: 'auto', maxHeight: '40vh', border: '1px solid #30363d', borderRadius: 6 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th} onClick={() => setPreviewSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>
                    date {previewSortDir === 'asc' ? '▲' : '▼'}
                  </th>
                  {preview.columns.map((c) => (
                    <th key={c} style={{ ...S.th, cursor: 'default' }}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRowsSorted.map((row, i) => (
                  <tr key={i}>
                    <td style={S.td}>{String(row['date'] ?? '')}</td>
                    {preview.columns.map((c) => (
                      <td key={c} style={S.td}>
                        {String(row[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
