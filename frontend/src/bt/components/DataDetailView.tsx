import { useEffect, useState } from 'react'
import { dataApi, priceDataApi, type DataSourceRow, type PriceRow } from '../../api/bt'
import { formatDate } from '../../utils/format'

const PAGE_SIZES = [25, 50, 100] as const
const PRICE_COLS = ['date', 'open', 'high', 'low', 'close', 'adj_close', 'volume'] as const

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  section: { marginBottom: 24 } as const,
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#c9d1d9', marginBottom: 8 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: '4px 8px', background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  thActive: { border: '1px solid #58a6ff', padding: '4px 8px', background: '#1f2b3a', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 1 } as const,
  td: { border: '1px solid #30363d', padding: '4px 8px', whiteSpace: 'nowrap' as const } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  select: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDis: { background: '#21262d', color: '#484f58', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'not-allowed' } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
  header: { fontSize: 13, color: '#8b949e', marginBottom: 6 } as const,
}

type TableResp = { columns: string[]; rows: Record<string, unknown>[]; total: number; offset: number; limit: number }

interface Props {
  selectedId: number | null
  selectedType: 'indicator' | 'signal' | null
  onBack: () => void
}

export default function DataDetailView({ selectedId, selectedType, onBack }: Props) {
  // Price data state
  const [tickers, setTickers] = useState<{ symbol: string; interval: string; start: string; end: string; count: number }[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string>('')
  const [priceRows, setPriceRows] = useState<PriceRow[]>([])
  const [priceTotal, setPriceTotal] = useState(0)
  const [priceLoading, setPriceLoading] = useState(false)
  const [pricePage, setPricePage] = useState(0)
  const [pricePageSize, setPricePageSize] = useState(50)
  const [priceSortBy, setPriceSortBy] = useState<string | null>('date')
  const [priceSortDir, setPriceSortDir] = useState<'asc' | 'desc'>('desc')
  const [priceSearch, setPriceSearch] = useState('')
  const [priceSearchDraft, setPriceSearchDraft] = useState('')
  const [priceMsg, setPriceMsg] = useState('')

  // Indicator state
  const [indicators, setIndicators] = useState<DataSourceRow[]>([])
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<number | null>(null)
  const [indTable, setIndTable] = useState<TableResp | null>(null)
  const [indLoading, setIndLoading] = useState(false)
  const [indPage, setIndPage] = useState(0)
  const [indPageSize, setIndPageSize] = useState(50)
  const [indSortBy, setIndSortBy] = useState<string | null>('date')
  const [indSortDir, setIndSortDir] = useState<'asc' | 'desc'>('desc')
  const [indSearch, setIndSearch] = useState('')
  const [indSearchDraft, setIndSearchDraft] = useState('')
  const [indMsg, setIndMsg] = useState('')

  // Signal state
  const [signals, setSignals] = useState<DataSourceRow[]>([])
  const [selectedSignalId, setSelectedSignalId] = useState<number | null>(null)
  const [sigTable, setSigTable] = useState<TableResp | null>(null)
  const [sigLoading, setSigLoading] = useState(false)
  const [sigPage, setSigPage] = useState(0)
  const [sigPageSize, setSigPageSize] = useState(50)
  const [sigSortBy, setSigSortBy] = useState<string | null>('date')
  const [sigSortDir, setSigSortDir] = useState<'asc' | 'desc'>('desc')
  const [sigSearch, setSigSearch] = useState('')
  const [sigSearchDraft, setSigSearchDraft] = useState('')
  const [sigMsg, setSigMsg] = useState('')

  const currentTicker = tickers.find((t) => t.symbol === selectedSymbol)

  useEffect(() => {
    priceDataApi.list().then(setTickers).catch((e: unknown) => setPriceMsg(String(e)))
    dataApi.listIndicators().then(setIndicators).catch((e: unknown) => setIndMsg(String(e)))
    dataApi.listSignals().then(setSignals).catch((e: unknown) => setSigMsg(String(e)))
  }, [])

  // initialise from nav props
  useEffect(() => {
    if (selectedType === 'indicator' && selectedId !== null) {
      setSelectedIndicatorId(selectedId)
      setSelectedSignalId(null)
    } else if (selectedType === 'signal' && selectedId !== null) {
      setSelectedSignalId(selectedId)
      setSelectedIndicatorId(null)
    }
  }, [selectedId, selectedType])

  useEffect(() => { setPricePage(0) }, [selectedSymbol, priceSearch, priceSortBy, priceSortDir, pricePageSize])
  useEffect(() => { setIndPage(0) }, [selectedIndicatorId, indSearch, indSortBy, indSortDir, indPageSize])
  useEffect(() => { setSigPage(0) }, [selectedSignalId, sigSearch, sigSortBy, sigSortDir, sigPageSize])

  useEffect(() => {
    if (!selectedSymbol) { setPriceRows([]); setPriceTotal(0); return }
    setPriceLoading(true)
    setPriceMsg('')
    priceDataApi.getRows(selectedSymbol, { sort_by: priceSortBy ?? undefined, sort_dir: priceSortDir, search: priceSearch || undefined, limit: pricePageSize, offset: pricePage * pricePageSize }).then((rows) => {
      setPriceRows(rows)
      if (priceSearch) {
        setPriceTotal(rows.length === pricePageSize ? pricePage * pricePageSize + rows.length + 1 : pricePage * pricePageSize + rows.length)
      } else {
        setPriceTotal(currentTicker?.count ?? rows.length)
      }
      setPriceLoading(false)
    }).catch((e: unknown) => { setPriceMsg(String(e)); setPriceLoading(false) })
  }, [selectedSymbol, pricePage, pricePageSize, priceSortBy, priceSortDir, priceSearch, currentTicker?.count])

  useEffect(() => {
    if (selectedIndicatorId === null) { setIndTable(null); return }
    setIndLoading(true)
    setIndMsg('')
    dataApi.table(selectedIndicatorId, {
      limit: indPageSize,
      offset: indPage * indPageSize,
      sort_by: indSortBy ?? undefined,
      sort_dir: indSortDir,
      search: indSearch || undefined,
    }).then(setIndTable).catch((e: unknown) => { setIndMsg(String(e)) }).finally(() => setIndLoading(false))
  }, [selectedIndicatorId, indPage, indPageSize, indSortBy, indSortDir, indSearch])

  useEffect(() => {
    if (selectedSignalId === null) { setSigTable(null); return }
    setSigLoading(true)
    setSigMsg('')
    dataApi.table(selectedSignalId, {
      limit: sigPageSize,
      offset: sigPage * sigPageSize,
      sort_by: sigSortBy ?? undefined,
      sort_dir: sigSortDir,
      search: sigSearch || undefined,
    }).then(setSigTable).catch((e: unknown) => { setSigMsg(String(e)) }).finally(() => setSigLoading(false))
  }, [selectedSignalId, sigPage, sigPageSize, sigSortBy, sigSortDir, sigSearch])

  const priceTotalPages = Math.ceil(priceTotal / pricePageSize)
  const indTotalPages = indTable ? Math.ceil(indTable.total / indPageSize) : 0
  const sigTotalPages = sigTable ? Math.ceil(sigTable.total / sigPageSize) : 0

  return (
    <div style={S.wrap}>
      <div style={{ ...S.row, marginBottom: 16 }}>
        <button type="button" style={S.btn} onClick={onBack}>← Indietro</button>
        {selectedType === 'indicator' && <span style={S.header}>Indicator # {selectedId}</span>}
        {selectedType === 'signal' && <span style={S.header}>Signal # {selectedId}</span>}
      </div>

      {/* ── Price Data Section ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Price Data</div>
        <div style={S.row}>
          <select style={{ ...S.select, minWidth: 200 }} value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
            <option value="">— seleziona ticker —</option>
            {tickers.map((t) => (
              <option key={t.symbol} value={t.symbol}>{t.symbol} ({t.count} rows)</option>
            ))}
          </select>
          <input
            style={S.input}
            placeholder="cerca nei dati…"
            value={priceSearchDraft}
            onChange={(e) => setPriceSearchDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setPriceSearch(priceSearchDraft) }}
          />
          <button type="button" style={S.btn} onClick={() => setPriceSearch(priceSearchDraft)}>Filtra</button>
          {(priceSearch || priceSortBy !== 'date' || priceSortDir !== 'desc') && (
            <button type="button" style={S.btn} onClick={() => { setPriceSearch(''); setPriceSearchDraft(''); setPriceSortBy('date'); setPriceSortDir('desc') }}>Reset</button>
          )}
          <select style={S.select} value={pricePageSize} onChange={(e) => setPricePageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pagina</option>)}
          </select>
        </div>
        {priceMsg && <div style={S.msgErr}>{priceMsg}</div>}
        {priceLoading && <div style={S.header}>caricamento…</div>}
        {selectedSymbol && currentTicker && (
          <div style={S.header}>
            {currentTicker.symbol} · {currentTicker.interval} · {formatDate(currentTicker.start)} → {formatDate(currentTicker.end)} · {priceTotal} righe
            {priceSearch && ` (filtrate)`}
          </div>
        )}
        {priceRows.length > 0 && (
          <div style={{ overflow: 'auto', maxHeight: '40vh', border: '1px solid #30363d', borderRadius: 6 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  {PRICE_COLS.map((c) => (
                    <th key={c} style={priceSortBy === c ? S.thActive : S.th} onClick={() => {
                      if (priceSortBy === c) setPriceSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                      else { setPriceSortBy(c); setPriceSortDir('asc') }
                    }}>
                      {c} {priceSortBy === c ? (priceSortDir === 'asc' ? '▲' : '▼') : '↕'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {priceRows.map((r, i) => (
                  <tr key={i}>
                    <td style={S.td}>{formatDate(r.date)}</td>
                    <td style={S.td}>{r.open ?? ''}</td>
                    <td style={S.td}>{r.high ?? ''}</td>
                    <td style={S.td}>{r.low ?? ''}</td>
                    <td style={S.td}>{r.close ?? ''}</td>
                    <td style={S.td}>{r.adj_close ?? ''}</td>
                    <td style={S.td}>{r.volume ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {priceRows.length === 0 && !priceLoading && selectedSymbol && (
          <div style={{ fontSize: 13, color: '#8b949e', padding: 12 }}>Nessun dato per "{selectedSymbol}"</div>
        )}
        {priceRows.length > 0 && (
          <div style={{ ...S.row, marginTop: 8 }}>
            <button type="button" style={pricePage === 0 ? S.btnDis : S.btn} disabled={pricePage === 0} onClick={() => setPricePage((p) => Math.max(0, p - 1))}>‹ Prev</button>
            <span style={{ fontSize: 13 }}>pag. {pricePage + 1} / {Math.max(priceTotalPages, 1)}</span>
            <button type="button" style={pricePage + 1 >= priceTotalPages ? S.btnDis : S.btn} disabled={pricePage + 1 >= priceTotalPages} onClick={() => setPricePage((p) => p + 1)}>Next ›</button>
          </div>
        )}
      </div>

      {/* ── Indicators Section ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Indicatori <span style={{ fontSize: 12, color: '#8b949e' }}>({indicators.length} salvati)</span></div>
        {indicators.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8b949e', padding: '8px 0' }}>Nessun indicatore calcolato. Usa il pannello Indicators nel Builder per crearne.</div>
        ) : (
          <>
            <div style={S.row}>
              <select
                style={{ ...S.select, minWidth: 260 }}
                value={selectedIndicatorId ?? ''}
                onChange={(e) => setSelectedIndicatorId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— seleziona indicatore —</option>
                {indicators.map((ind) => (
                  <option key={ind.id} value={ind.id}>
                    {ind.name} ({String((ind.meta as Record<string, unknown>)?.indicator_type ?? '?')} · {ind.path_or_tickers})
                  </option>
                ))}
              </select>
              <input
                style={S.input}
                placeholder="cerca…"
                value={indSearchDraft}
                onChange={(e) => setIndSearchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setIndSearch(indSearchDraft) }}
              />
              <button type="button" style={S.btn} onClick={() => setIndSearch(indSearchDraft)}>Filtra</button>
              {(indSearch || indSortBy || indSortDir !== 'desc') && (
                <button type="button" style={S.btn} onClick={() => { setIndSearch(''); setIndSearchDraft(''); setIndSortBy('date'); setIndSortDir('desc') }}>Reset</button>
              )}
              <select style={S.select} value={indPageSize} onChange={(e) => setIndPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pagina</option>)}
              </select>
            </div>
            {indMsg && <div style={S.msgErr}>{indMsg}</div>}
            {indLoading && <div style={S.header}>caricamento…</div>}
            {indTable && indTable.rows.length > 0 && (
              <div style={{ overflow: 'auto', maxHeight: '40vh', border: '1px solid #30363d', borderRadius: 6 }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={indSortBy === 'date' ? S.thActive : S.th} onClick={() => {
                        if (indSortBy === 'date') setIndSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else { setIndSortBy('date'); setIndSortDir('asc') }
                      }}>
                        date {indSortBy === 'date' ? (indSortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      {indTable.columns.map((c) => (
                        <th key={c} style={indSortBy === c ? S.thActive : S.th} onClick={() => {
                          if (indSortBy === c) setIndSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                          else { setIndSortBy(c); setIndSortDir('asc') }
                        }}>
                          {c} {indSortBy === c ? (indSortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {indTable.rows.map((row, i) => (
                      <tr key={i}>
                        <td style={S.td}>{formatDate(String(row['date'] ?? ''))}</td>
                        {indTable.columns.map((c) => (
                          <td key={c} style={S.td}>{row[c] === null || row[c] === undefined ? '' : String(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {indTable && indTable.rows.length === 0 && !indLoading && (
              <div style={{ fontSize: 13, color: '#8b949e', padding: 8 }}>Nessun dato per questo indicatore</div>
            )}
            {indTable && indTable.rows.length > 0 && (
              <div style={{ ...S.row, marginTop: 8 }}>
                <button type="button" style={indPage === 0 ? S.btnDis : S.btn} disabled={indPage === 0} onClick={() => setIndPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
                <span style={{ fontSize: 13 }}>pag. {indPage + 1} / {Math.max(indTotalPages, 1)}</span>
                <button type="button" style={indPage + 1 >= indTotalPages ? S.btnDis : S.btn} disabled={indPage + 1 >= indTotalPages} onClick={() => setIndPage((p) => p + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Signals Section ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Signals <span style={{ fontSize: 12, color: '#8b949e' }}>({signals.length} salvati)</span></div>
        {signals.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8b949e', padding: '8px 0' }}>Nessun signal calcolato. Usa il pannello Signals nel Builder per crearne.</div>
        ) : (
          <>
            <div style={S.row}>
              <select
                style={{ ...S.select, minWidth: 260 }}
                value={selectedSignalId ?? ''}
                onChange={(e) => setSelectedSignalId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— seleziona signal —</option>
                {signals.map((sig) => (
                  <option key={sig.id} value={sig.id}>
                    {sig.name} ({sig.path_or_tickers})
                  </option>
                ))}
              </select>
              <input
                style={S.input}
                placeholder="cerca…"
                value={sigSearchDraft}
                onChange={(e) => setSigSearchDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setSigSearch(sigSearchDraft) }}
              />
              <button type="button" style={S.btn} onClick={() => setSigSearch(sigSearchDraft)}>Filtra</button>
              {(sigSearch || sigSortBy || sigSortDir !== 'desc') && (
                <button type="button" style={S.btn} onClick={() => { setSigSearch(''); setSigSearchDraft(''); setSigSortBy('date'); setSigSortDir('desc') }}>Reset</button>
              )}
              <select style={S.select} value={sigPageSize} onChange={(e) => setSigPageSize(Number(e.target.value))}>
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / pagina</option>)}
              </select>
            </div>
            {sigMsg && <div style={S.msgErr}>{sigMsg}</div>}
            {sigLoading && <div style={S.header}>caricamento…</div>}
            {sigTable && sigTable.rows.length > 0 && (
              <div style={{ overflow: 'auto', maxHeight: '40vh', border: '1px solid #30363d', borderRadius: 6 }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={sigSortBy === 'date' ? S.thActive : S.th} onClick={() => {
                        if (sigSortBy === 'date') setSigSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                        else { setSigSortBy('date'); setSigSortDir('asc') }
                      }}>
                        date {sigSortBy === 'date' ? (sigSortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                      {sigTable.columns.map((c) => (
                        <th key={c} style={sigSortBy === c ? S.thActive : S.th} onClick={() => {
                          if (sigSortBy === c) setSigSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
                          else { setSigSortBy(c); setSigSortDir('asc') }
                        }}>
                          {c} {sigSortBy === c ? (sigSortDir === 'asc' ? '▲' : '▼') : '↕'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sigTable.rows.map((row, i) => (
                      <tr key={i}>
                        <td style={S.td}>{formatDate(String(row['date'] ?? ''))}</td>
                        {sigTable.columns.map((c) => (
                          <td key={c} style={S.td}>{row[c] === null || row[c] === undefined ? '' : String(row[c])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sigTable && sigTable.rows.length === 0 && !sigLoading && selectedSignalId !== null && (
              <div style={{ fontSize: 13, color: '#8b949e', padding: 8 }}>Nessun dato per questo signal</div>
            )}
            {sigTable && sigTable.rows.length > 0 && (
              <div style={{ ...S.row, marginTop: 8 }}>
                <button type="button" style={sigPage === 0 ? S.btnDis : S.btn} disabled={sigPage === 0} onClick={() => setSigPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
                <span style={{ fontSize: 13 }}>pag. {sigPage + 1} / {Math.max(sigTotalPages, 1)}</span>
                <button type="button" style={sigPage + 1 >= sigTotalPages ? S.btnDis : S.btn} disabled={sigPage + 1 >= sigTotalPages} onClick={() => setSigPage((p) => p + 1)}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
