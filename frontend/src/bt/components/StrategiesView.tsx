import { useCallback, useEffect, useState } from 'react'
import { formatCreatedAt, strategiesApi, type StrategyRow } from '../../api/bt'
import { useBtStore } from '../store/btStore'
import type { NodeConfig } from '../../types/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  layout: { display: 'flex', gap: 12, alignItems: 'flex-start' } as const,
  left: { flex: 1, minWidth: 0 } as const,
  right: { width: 380, minWidth: 320, border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, position: 'sticky' as const, top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' as const } as const,
  tableWrap: { overflow: 'auto', maxHeight: '60vh', border: '1px solid #30363d', borderRadius: 6 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 2 } as const,
  thFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', position: 'sticky' as const, top: 32, zIndex: 2 } as const,
  thCb: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'center' as const, position: 'sticky' as const, top: 0, zIndex: 2, width: 36 } as const,
  thCbFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', textAlign: 'center' as const, position: 'sticky' as const, top: 32, zIndex: 2, width: 36 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  inputSm: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '4px 6px', width: '100%', fontSize: 12 } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnSmall: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
  badge: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' } as const,
  nodeBox: { border: '1px solid #30363d', borderRadius: 8, background: '#161b22', padding: '8px 10px', marginBottom: 8 } as const,
  nodeChildren: { marginLeft: 12, borderLeft: '1px dashed #21262d', paddingLeft: 8, display: 'flex', flexDirection: 'column' as const, gap: 6, marginTop: 6 } as const,
}

function countNodes(n: NodeConfig): number {
  let c = 1
  for (const ch of n.children) c += countNodes(ch)
  return c
}

function PreviewNode({ node }: { node: NodeConfig }) {
  const isStrategy = node.type === 'Strategy' || node.type === 'FixedIncomeStrategy'
  return (
    <div style={S.nodeBox}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{node.name}</span>
        <span style={S.badge}>{node.type}</span>
        {isStrategy && node.algos.length > 0 && <span style={S.badge}>{node.algos.length} algos</span>}
      </div>
      {node.algos.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
          {node.algos.map((a, i) => (
            <span key={i} style={{ ...S.badge, background: '#1f2b3a' }}>{a.class_name}</span>
          ))}
        </div>
      )}
      {isStrategy && node.children.length > 0 && (
        <div style={S.nodeChildren}>
          {node.children.map((c) => (
            <PreviewNode key={c.id} node={c} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function StrategiesView() {
  const [rows, setRows] = useState<StrategyRow[]>([])
  const [msg, setMsg] = useState('')
  const [search, setSearch] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [fId, setFId] = useState('')
  const [fName, setFName] = useState('')
  const [fCreatedAt, setFCreatedAt] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<StrategyRow | null>(null)

  const setTree = useBtStore((s) => s.setTree)

  const refresh = useCallback(() => {
    strategiesApi
      .list({
        search: search || undefined,
        sort_by: sortBy ?? undefined,
        sort_dir: sortDir,
        filter_id: fId || undefined,
        filter_name: fName || undefined,
        filter_created_at: fCreatedAt || undefined,
      })
      .then((data) => {
        setRows(data)
        setSelected((prev) => {
          const ids = new Set(data.map((r) => r.id))
          const n = new Set<number>()
          for (const id of prev) if (ids.has(id)) n.add(id)
          return n
        })
      })
      .catch((e: unknown) => setMsg(String(e)))
  }, [search, sortBy, sortDir, fId, fName, fCreatedAt])

  useEffect(() => { refresh() }, [refresh])

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
    if (checked) setSelected(new Set(rows.map((r) => r.id)))
    else setSelected(new Set())
  }

  const handleDeleteOne = async (id: number, name: string) => {
    if (!window.confirm(`Eliminare strategia "${name}" (#${id})?`)) return
    try {
      await strategiesApi.delete(id)
      setMsg(`[ok] eliminata ${name}`)
      if (preview?.id === id) setPreview(null)
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
      refresh()
    } catch (e) { setMsg(`[err] ${String(e)}`) }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!window.confirm(`Eliminare ${selected.size} strategie selezionate?`)) return
    try {
      const r = await strategiesApi.bulkDelete([...selected])
      setMsg(`[ok] eliminate ${r.deleted} strategie`)
      if (preview && selected.has(preview.id)) setPreview(null)
      setSelected(new Set())
      refresh()
    } catch (e) { setMsg(`[err] ${String(e)}`) }
  }

  const handlePreview = async (id: number) => {
    try {
      const r = await strategiesApi.get(id)
      setPreview(r)
    } catch (e) { setMsg(String(e)) }
  }

  const handleLoad = (row: StrategyRow) => {
    const tree = row.tree as unknown as ReturnType<typeof useBtStore.getState>['tree']
    if (tree) setTree(tree)
    setMsg(`[ok] caricata ${row.name} (#${row.id}) — vai in Builder per editare`)
  }

  const resetFilters = () => {
    setSearch(''); setSearchDraft('')
    setFId(''); setFName(''); setFCreatedAt('')
    setSortBy(null); setSortDir('asc')
  }

  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const hasFilter = search || sortBy || fId || fName || fCreatedAt

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Strategies</h3>
      <div style={S.row}>
        <input style={S.input} placeholder="cerca globale" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setSearch(searchDraft) }} />
        <button type="button" style={S.btn} onClick={() => setSearch(searchDraft)}>Filtra</button>
        {hasFilter && <button type="button" style={S.btn} onClick={resetFilters}>Reset</button>}
        <button type="button" style={S.btn} onClick={refresh}>Refresh</button>
        <span style={{ fontSize: 12, color: '#8b949e' }}>{rows.length} strategie{hasFilter ? ' (filtrate)' : ''}{selected.size > 0 ? ` · selezionate: ${selected.size}` : ''}</span>
      </div>
      {selected.size > 0 && (
        <div style={{ ...S.row, marginBottom: 8 }}>
          <button type="button" style={S.btnDanger} onClick={handleBulkDelete}>Elimina selezionate ({selected.size})</button>
          <button type="button" style={S.btn} onClick={() => setSelected(new Set())}>Deseleziona</button>
        </div>
      )}
      {msg && <div style={msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{msg}</div>}

      <div style={S.layout}>
        <div style={S.left}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.thCb}><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} title="Seleziona tutti" /></th>
                  <th style={S.th} onClick={() => handleSort('id')}>id{sortIcon('id')}</th>
                  <th style={S.th} onClick={() => handleSort('name')}>name{sortIcon('name')}</th>
                  <th style={S.th} onClick={() => handleSort('created_at')}>created_at{sortIcon('created_at')}</th>
                  <th style={{ ...S.th, cursor: 'default' }}>nodes</th>
                  <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Load</th>
                  <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Preview</th>
                  <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Delete</th>
                </tr>
                <tr>
                  <th style={S.thCbFilter}></th>
                  <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra id" value={fId} onChange={(e) => setFId(e.target.value)} /></th>
                  <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra name" value={fName} onChange={(e) => setFName(e.target.value)} /></th>
                  <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra created_at" value={fCreatedAt} onChange={(e) => setFCreatedAt(e.target.value)} /></th>
                  <th style={S.thFilter}></th>
                  <th style={S.thFilter}></th>
                  <th style={S.thFilter}></th>
                  <th style={S.thFilter}></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td style={S.td} colSpan={8}>{hasFilter ? 'nessuna strategia (filtrata) — premi Reset' : 'nessuna strategia — creane una in Builder'}</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} style={preview?.id === r.id ? { background: '#161b22' } : undefined}>
                    <td style={{ ...S.td, textAlign: 'center' as const }}><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                    <td style={S.td}>{r.id}</td>
                    <td style={S.td}>{r.name}</td>
                    <td style={S.td}>{formatCreatedAt(r.created_at)}</td>
                    <td style={S.td}>{(() => { try { const root = (r.tree as unknown as { root: NodeConfig }).root; return root ? `${countNodes(root)} nodi` : '' } catch { return '' } })()}</td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={S.btnSmall} onClick={() => handleLoad(r)}>Load</button></td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={S.btnSmall} onClick={() => handlePreview(r.id)}>Preview</button></td>
                    <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={S.btnDanger} onClick={() => handleDeleteOne(r.id, r.name)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={S.right}>
          {!preview ? (
            <div style={{ color: '#8b949e', fontSize: 13 }}>Seleziona Preview su una strategia per vedere l’anteprima albero.</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontWeight: 700, flex: 1 }}>{preview.name} <span style={{ color: '#8b949e', fontWeight: 400 }}>#{preview.id}</span></span>
                <button type="button" style={S.btnPri} onClick={() => handleLoad(preview)}>Load in Builder</button>
                <button type="button" style={S.btnSmall} onClick={() => setPreview(null)}>Chiudi</button>
              </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>{formatCreatedAt(preview.created_at)} · v{(preview.tree as unknown as { version?: number }).version ?? 1}</div>
              {(() => {
                try {
                  const root = (preview.tree as unknown as { root: NodeConfig }).root
                  if (!root) return <div style={{ color: '#8b949e' }}>albero vuoto</div>
                  return <PreviewNode node={root} />
                } catch (e) {
                  return <div style={{ color: '#f85149', fontSize: 12 }}>errore preview: {String(e)}</div>
                }
              })()}
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#8b949e' }}>JSON</summary>
                <pre style={{ fontSize: 11, background: '#010409', border: '1px solid #30363d', borderRadius: 6, padding: 8, overflow: 'auto', maxHeight: 300 }}>{JSON.stringify(preview.tree, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
