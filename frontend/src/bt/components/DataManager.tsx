import { useEffect, useState } from 'react'
import { dataApi, type DataSourceRow } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' } as const,
  td: { border: '1px solid #30363d', padding: 6 } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } as const,
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
  const [msg, setMsg] = useState('')

  const refresh = () => {
    dataApi
      .list()
      .then(setRows)
      .catch((e: unknown) => setMsg(String(e)))
  }
  useEffect(() => {
    refresh()
  }, [])

  const handleUpload = async () => {
    if (!file || !name) {
      setMsg('name + file required')
      return
    }
    try {
      await dataApi.upload(name, dtype, file)
      setMsg(`uploaded ${name}`)
      refresh()
    } catch (e) {
      setMsg(String(e))
    }
  }

  const handleFetch = async () => {
    if (!name) {
      setMsg('name required')
      return
    }
    const t = tickers
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      await dataApi.fetchFfn(name, dtype, t, start, end)
      setMsg(`fetched ${name}`)
      refresh()
    } catch (e) {
      setMsg(String(e))
    }
  }

  const handlePreview = async (id: number) => {
    try {
      const p = await dataApi.preview(id)
      setPreview({ columns: p.columns, rows: p.rows })
    } catch (e) {
      setMsg(String(e))
    }
  }

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Data Manager</h3>
      <div style={S.row}>
        <input style={S.input} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
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
      {msg && <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>{msg}</div>}
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>id</th>
            <th style={S.th}>name</th>
            <th style={S.th}>type</th>
            <th style={S.th}>source</th>
            <th style={S.th}>meta</th>
            <th style={S.th}>action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={S.td}>{r.id}</td>
              <td style={S.td}>{r.name}</td>
              <td style={S.td}>{r.type}</td>
              <td style={S.td}>{r.source}</td>
              <td style={S.td}>{JSON.stringify(r.meta)}</td>
              <td style={S.td}>
                <button type="button" style={S.btn} onClick={() => handlePreview(r.id)}>
                  preview
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 4 }}>preview {preview.columns.join(', ')}</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>date</th>
                {preview.columns.map((c) => (
                  <th key={c} style={S.th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row, i) => (
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
      )}
    </div>
  )
}
