import { useCallback, useEffect, useMemo, useState } from 'react'
import { dataApi, priceDataApi, type PriceTickerRow } from '../../api/bt'
import { loadSettings } from '../../api/settings'
import { formatDate } from '../../utils/format'
import { applySearch, applySort } from '../../utils/listQuery'
import DateInputIT from './DateInputIT'

const COLUMNS: { key: keyof PriceTickerRow; label: string }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'interval', label: 'Interval' },
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
  { key: 'count', label: 'Rows' },
]

type SortState = { by: string | null; dir: 'asc' | 'desc' }
type FilterState = Record<string, string>

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: '4px 8px', background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thActive: { border: '1px solid #58a6ff', padding: '4px 8px', background: '#1f2b3a', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thFilter: { border: '1px solid #30363d', padding: '2px 4px', background: '#0d1117', textAlign: 'left' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 28, zIndex: 1 } as const,
  td: { border: '1px solid #30363d', padding: '4px 8px', whiteSpace: 'nowrap' as const } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '3px 6px', fontSize: 12, width: '100%', boxSizing: 'border-box' as const },
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnView: { background: '#1f6feb', color: '#fff', border: '1px solid #1f6feb', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnViewHide: { background: '#6e4022', color: '#fff', border: '1px solid #9e6a16', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
  dataWrap: { border: '1px solid #30363d', borderRadius: 4, marginTop: 4, overflow: 'auto', maxHeight: 300, background: '#0d1117' } as const,
  dataTh: { border: '1px solid #30363d', padding: '3px 8px', background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1, fontSize: 12 } as const,
  dataTd: { border: '1px solid #30363d', padding: '2px 8px', fontSize: 12, whiteWhite: 'nowrap' as const } as const,
}

const ROW_COLS = ['date', 'open', 'high', 'low', 'close', 'adj_close', 'volume'] as const

export default function DataManager({ onNavigate }: { onNavigate?: (symbol: string) => void }) {
  const [tickers, setTickers] = useState<PriceTickerRow[]>([])
  const [symbolInput, setSymbolInput] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [sort, setSort] = useState<SortState>({ by: null, dir: 'asc' })
  const [filters, setFilters] = useState<FilterState>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rowCache, setRowCache] = useState<Record<string, { date: string; open: number | null; high: number | null; low: number | null; close: number | null; adj_close: number | null; volume: number | null }[]>>({})
  const [msg, setMsg] = useState('')
  const [adapter, setAdapter] = useState<'ffn' | 'yfinance'>(loadSettings().data_adapter)

  const refresh = useCallback(() => {
    priceDataApi.list().then(setTickers).catch((e: unknown) => setMsg(String(e)))
  }, [])

  useEffect(() => { setAdapter(loadSettings().data_adapter) }, [])
  useEffect(() => { refresh() }, [refresh])

  const handleFetch = async () => {
    const raw = symbolInput.trim()
    if (!raw) { setMsg('ticker required (e.g. AAPL)'); return }
    const symbols = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    if (symbols.length === 0) { setMsg('ticker required (e.g. AAPL)'); return }

    setMsg('')
    const results: string[] = []
    for (const sym of symbols) {
      try {
        const r = await dataApi.fetch(adapter, { symbol: sym, start: start || undefined, end: end || undefined })
        if (r.adapter === 'yfinance') results.push(`[ok] ${r.symbol} — ${r.rows} rows`)
        else results.push(`[ok] ${r.name} — ${r.rows} rows`)
      } catch (e) {
        results.push(`[err] ${sym}: ${String(e)}`)
      }
    }
    setMsg(results.join('\n'))
    setSymbolInput('')
    refresh()
  }

  const handleDelete = async (symbol: string) => {
    if (!window.confirm(`Eliminare dati per "${symbol}"?`)) return
    // ponytail: delete via price_data endpoint (adapter=yfinance path)
    try {
      await fetch(`/api/bt/price-data/${encodeURIComponent(symbol)}`, { method: 'DELETE' })
      setMsg(`[ok] deleted ${symbol}`)
      setRowCache((c) => { const n = { ...c }; delete n[symbol]; return n })
      setExpanded((s) => { const n = new Set(s); n.delete(symbol); return n })
      refresh()
    } catch (e) {
      setMsg(`[err] ${String(e)}`)
    }
  }



  const handleSort = (key: string) => {
    setSort((prev) => ({
      by: key,
      dir: prev.by === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc',
    }))
  }

  const handleFilter = (key: string, val: string) => {
    setFilters((prev) => ({ ...prev, [key]: val }))
  }

  const sortedFiltered = useMemo(() => {
    let list = [...tickers]
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue
      list = applySearch(list, val, [key as keyof PriceTickerRow])
    }
    if (sort.by) list = applySort(list, sort.by, sort.dir)
    return list
  }, [tickers, sort, filters])

  const sortIcon = (key: string) => {
    if (sort.by !== key) return ' ↕'
    return sort.dir === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Ticker Catalog</h3>
      <div style={S.row}>
        <input
          style={{ ...S.input, width: 120 }}
          placeholder="TICKER"
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleFetch() }}
        />
        <DateInputIT style={S.input} value={start} onChange={setStart} placeholder="start_date" tooltip={formatDate(start) || 'gg/mm/aaaa'} />
        <DateInputIT style={S.input} value={end} onChange={setEnd} placeholder="end_date" tooltip={formatDate(end) || 'gg/mm/aaaa'} />
        <button type="button" style={S.btnPri} onClick={handleFetch}>Fetch</button>
      </div>
      {msg && <div style={msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{msg}</div>}
      <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid #30363d', borderRadius: 6 }}>
        <table style={S.table}>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} style={sort.by === col.key ? S.thActive : S.th} onClick={() => handleSort(col.key)}>
                  {col.label}{sortIcon(col.key)}
                </th>
              ))}
              <th style={{ ...S.th, textAlign: 'center' as const }}>View</th>
              <th style={{ ...S.th, textAlign: 'center' as const }}>Actions</th>
            </tr>
            <tr>
              {COLUMNS.map((col) => (
                <th key={`f-${col.key}`} style={S.thFilter}>
                  <input
                    style={S.input}
                    placeholder={`filter…`}
                    value={filters[col.key] ?? ''}
                    onChange={(e) => handleFilter(col.key, e.target.value)}
                  />
                </th>
              ))}
              <th style={S.thFilter} /><th style={S.thFilter} />
            </tr>
          </thead>
          <tbody>
            {sortedFiltered.length === 0 ? (
              <tr><td style={S.td} colSpan={7}>Nessun ticker — inserisci un simbolo e premi Fetch</td></tr>
            ) : sortedFiltered.map((t) => {
              const isExpanded = expanded.has(t.symbol)
              const rows = rowCache[t.symbol] ?? []
              return (
                <>
                  <tr key={t.symbol}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{t.symbol}</td>
                    <td style={S.td}>{t.interval}</td>
                    <td style={S.td}>{formatDate(t.start)}</td>
                    <td style={S.td}>{formatDate(t.end)}</td>
                    <td style={S.td}>{t.count}</td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}>
                      <button type="button" style={S.btnView} onClick={() => {
                        if (onNavigate) onNavigate(t.symbol)
                        else window.dispatchEvent(new CustomEvent('bt-navigate-price', { detail: t.symbol }))
                      }}>View</button>
                    </td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}>
                      <button type="button" style={S.btnDanger} onClick={() => handleDelete(t.symbol)}>Delete</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${t.symbol}-data`}>
                      <td style={{ ...S.td, background: '#161b22' }} colSpan={7}>
                        <div style={{ padding: '4px 8px', fontSize: 12, color: '#8b949e', marginBottom: 4 }}>
                          {rows.length} righe per {t.symbol}
                        </div>
                        <div style={S.dataWrap}>
                          <table style={{ ...S.table, fontSize: 12 }}>
                            <thead>
                              <tr>
                                {ROW_COLS.map((c) => (
                                  <th key={c} style={S.dataTh}>{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, i) => (
                                <tr key={i}>
                                  <td style={S.dataTd}>{formatDate(r.date)}</td>
                                  <td style={S.dataTd}>{r.open ?? ''}</td>
                                  <td style={S.dataTd}>{r.high ?? ''}</td>
                                  <td style={S.dataTd}>{r.low ?? ''}</td>
                                  <td style={S.dataTd}>{r.close ?? ''}</td>
                                  <td style={S.dataTd}>{r.adj_close ?? ''}</td>
                                  <td style={S.dataTd}>{r.volume ?? ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
