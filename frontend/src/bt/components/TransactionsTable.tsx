import { useMemo, useState } from 'react'

const S = {
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const } as const,
  thFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117' } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  inputSm: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '4px 6px', width: '100%', fontSize: 12 } as const,
}

type Props = { tx: Record<string, unknown>[] }

export default function TransactionsTable({ tx }: Props) {
  const [txSortKey, setTxSortKey] = useState<string | null>(null)
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('asc')
  const [txFilters, setTxFilters] = useState<Record<string, string>>({})
  const txCols = useMemo(() => Object.keys(tx[0] ?? {}), [tx])
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
    return rows.slice(0, 20)
  }, [tx, txCols, txFilters, txSortKey, txSortDir])
  const txHandleSort = (col: string) => {
    if (txSortKey === col) setTxSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setTxSortKey(col); setTxSortDir('asc') }
  }
  const txSortIcon = (col: string) => (txSortKey === col ? (txSortDir === 'asc' ? ' ▲' : ' ▼') : ' ↕')
  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Transactions ({txDisplay.length})</div>
      <table style={S.table}>
        <thead>
          <tr>{txCols.map((k) => <th key={k} style={S.th} onClick={() => txHandleSort(k)}>{k}{txSortIcon(k)}</th>)}</tr>
          <tr>{txCols.map((k) => <th key={k} style={S.thFilter}><input style={S.inputSm} placeholder={`filtra ${k}`} value={txFilters[k] ?? ''} onChange={(e) => setTxFilters((p) => ({ ...p, [k]: e.target.value }))} /></th>)}</tr>
        </thead>
        <tbody>{txDisplay.map((row, i) => <tr key={i}>{txCols.map((k) => <td key={k} style={S.td}>{String(row[k] ?? '')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
