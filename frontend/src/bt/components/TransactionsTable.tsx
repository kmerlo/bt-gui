import { useMemo, useState } from 'react'
import { loadSettings, type BtSettings } from '../../api/settings'

const PAGE_SIZES = [25, 50, 100] as const

const S = {
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const } as const,
  thFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117' } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  inputSm: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '4px 6px', width: '100%', fontSize: 12 } as const,
  pgRow: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 8, fontSize: 12, color: '#8b949e' } as const,
  pgBtn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 } as const,
} as const

type Props = { tx: Record<string, unknown>[]; settings?: BtSettings }

export default function TransactionsTable({ tx, settings }: Props) {
  const settingsRef = settings ?? loadSettings()
  const [txSortKey, setTxSortKey] = useState<string | null>(null)
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('asc')
  const [txFilters, setTxFilters] = useState<Record<string, string>>({})
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const txCols = useMemo(() => Object.keys(tx[0] ?? {}), [tx])

  // ponytail: group index maps each unique Date → its rank (0 = first group, gets black bg)
  const groupIndex = useMemo(() => {
    const m = new Map<string, number>()
    let idx = 0
    for (const r of tx) {
      const d = String(r.Date ?? '')
      if (!m.has(d)) m.set(d, idx++)
    }
    return m
  }, [tx])

  const txBgColor = useMemo(() => {
    const color = settingsRef.tx_group_bg_color
    const opacity = settingsRef.tx_group_bg_opacity
    return (groupIdx: number) =>
      groupIdx % 2 === 0 ? '#000000'
        : `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, #0d1117)`
  }, [settingsRef])

  const txDisplay = useMemo(() => {
    let rows = [...tx]
    for (const k of txCols) {
      const v = txFilters[k]?.trim().toLowerCase()
      if (v) rows = rows.filter((r) => String(r[k] ?? '').toLowerCase().includes(v))
    }
    if (txSortKey) rows.sort((a, b) => {
      const av = String(a[txSortKey] ?? ''), bv = String(b[txSortKey] ?? '')
      return txSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return rows
  }, [tx, txCols, txFilters, txSortKey, txSortDir])

  // reset page when filters/sort change so we don't show empty pages
  useMemo(() => { setPage(0) }, [txCols.join(), txSortKey, JSON.stringify(txFilters)])

  const paged = useMemo(() => {
    const start = page * pageSize
    return txDisplay.slice(start, start + pageSize)
  }, [txDisplay, page, pageSize])

  const totalPages = Math.max(1, Math.ceil(txDisplay.length / pageSize))

  const txHandleSort = (col: string) => {
    if (txSortKey === col) setTxSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setTxSortKey(col); setTxSortDir('asc') }
  }
  const txSortIcon = (col: string) => (txSortKey === col ? (txSortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕')

  const pgPrev = () => setPage((p) => Math.max(0, p - 1))
  const pgNext = () => setPage((p) => Math.min(totalPages - 1, p + 1))

  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Transactions ({tx.length})</div>
      <table style={S.table}>
        <thead>
          <tr>{txCols.map((k) => <th key={k} style={S.th} onClick={() => txHandleSort(k)}>{k}{txSortIcon(k)}</th>)}</tr>
          <tr>{txCols.map((k) => <th key={k} style={S.thFilter}><input style={S.inputSm} placeholder={`filtra ${k}`} value={txFilters[k] ?? ''} onChange={(e) => setTxFilters((p) => ({ ...p, [k]: e.target.value }))} /></th>)}</tr>
        </thead>
        <tbody>{paged.map((row, i) => {
          const globalIdx = page * pageSize + i
          const gIdx = groupIndex.get(String(txDisplay[globalIdx]?.Date ?? '')) ?? 0
          return <tr key={globalIdx} style={{ background: txBgColor(gIdx) }}>{txCols.map((k) => <td key={k} style={S.td}>{String(row[k] ?? '')}</td>)}</tr>
        })}</tbody>
      </table>
      {txDisplay.length > pageSize && (
        <div style={S.pgRow}>
          <button type="button" style={page === 0 ? { ...S.pgBtn, opacity: 0.4 } : S.pgBtn} disabled={page === 0} onClick={pgPrev}>‹ Prev</button>
          <span>pag. {page + 1} / {totalPages} · {txDisplay.length} righe</span>
          <select style={S.inputSm} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pagina</option>)}
          </select>
          <button type="button" style={page + 1 >= totalPages ? { ...S.pgBtn, opacity: 0.4 } : S.pgBtn} disabled={page + 1 >= totalPages} onClick={pgNext}>Next ›</button>
        </div>
      )}
    </div>
  )
}
