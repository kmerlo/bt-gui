import { formatCreatedAt, type RunRow } from '../../api/bt'

const S = {
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  th: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'left' as const, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const, position: 'sticky' as const, top: 0, zIndex: 2 } as const,
  thFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', position: 'sticky' as const, top: 32, zIndex: 2 } as const,
  thCb: { border: '1px solid #30363d', padding: 6, background: '#161b22', textAlign: 'center' as const, position: 'sticky' as const, top: 0, zIndex: 2, width: 36 } as const,
  thCbFilter: { border: '1px solid #30363d', padding: 4, background: '#0d1117', textAlign: 'center' as const, position: 'sticky' as const, top: 32, zIndex: 2, width: 36 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  inputSm: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '4px 6px', width: '100%', fontSize: 12 } as const,
  btnSmall: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #238636', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
}

type Props = {
  runs: RunRow[]
  sel: number | null
  expanded: Set<number>
  selected: Set<number>
  sortBy: string | null
  sortDir: 'asc' | 'desc'
  allChecked: boolean
  hasFilter: boolean
  fId: string
  fStrategyName: string
  fCreatedAt: string
  fStart: string
  fEnd: string
  fTotalReturn: string
  fMaxDrawdown: string
  fSharpe: string
  fSortino: string
  fStats: string
  onSort: (_col: string) => void
  sortIcon: (_col: string) => string
  onToggleOne: (_id: number) => void
  onToggleAll: (_checked: boolean) => void
  onToggleExpanded: (_id: number) => void
  onDeleteOne: (_id: number) => void
  setFId: (_v: string) => void
  setFStrategyName: (_v: string) => void
  setFCreatedAt: (_v: string) => void
  setFStart: (_v: string) => void
  setFEnd: (_v: string) => void
  setFTotalReturn: (_v: string) => void
  setFMaxDrawdown: (_v: string) => void
  setFSharpe: (_v: string) => void
  setFSortino: (_v: string) => void
  setFStats: (_v: string) => void
}

export default function RunsTable(p: Props) {
  return (
    <div style={{ overflow: 'auto', maxHeight: '50vh', border: '1px solid #30363d', borderRadius: 6, marginBottom: 12 }}>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.thCb}><input type="checkbox" checked={p.allChecked} onChange={(e) => p.onToggleAll(e.target.checked)} title="Seleziona tutti" /></th>
            <th style={S.th} onClick={() => p.onSort('id')}>id{p.sortIcon('id')}</th>
            <th style={S.th} onClick={() => p.onSort('strategy_name')}>strategy{p.sortIcon('strategy_name')}</th>
            <th style={S.th} onClick={() => p.onSort('created_at')}>created_at{p.sortIcon('created_at')}</th>
            <th style={S.th} onClick={() => p.onSort('start')}>start{p.sortIcon('start')}</th>
            <th style={S.th} onClick={() => p.onSort('end')}>end{p.sortIcon('end')}</th>
            <th style={S.th} onClick={() => p.onSort('total_return')}>Total Return{p.sortIcon('total_return')}</th>
            <th style={S.th} onClick={() => p.onSort('max_drawdown')}>Max DD{p.sortIcon('max_drawdown')}</th>
            <th style={S.th} onClick={() => p.onSort('sharpe')}>Shārpe{p.sortIcon('sharpe')}</th>
            <th style={S.th} onClick={() => p.onSort('sortino')}>Sortino{p.sortIcon('sortino')}</th>
            <th style={S.th} onClick={() => p.onSort('cagr')}>CAGR{p.sortIcon('cagr')}</th>
            <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>View</th>
            <th style={{ ...S.th, cursor: 'default', textAlign: 'center' as const }}>Delete</th>
          </tr>
          <tr>
            <th style={S.thCbFilter}></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra id" value={p.fId} onChange={(e) => p.setFId(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra strategy" value={p.fStrategyName} onChange={(e) => p.setFStrategyName(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra created_at" value={p.fCreatedAt} onChange={(e) => p.setFCreatedAt(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra start" value={p.fStart} onChange={(e) => p.setFStart(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra end" value={p.fEnd} onChange={(e) => p.setFEnd(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Total Return" value={p.fTotalReturn} onChange={(e) => p.setFTotalReturn(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Max DD" value={p.fMaxDrawdown} onChange={(e) => p.setFMaxDrawdown(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Shārpe" value={p.fSharpe} onChange={(e) => p.setFSharpe(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra Sortino" value={p.fSortino} onChange={(e) => p.setFSortino(e.target.value)} /></th>
            <th style={S.thFilter}><input style={S.inputSm} placeholder="filtra CAGR" value={p.fStats} onChange={(e) => p.setFStats(e.target.value)} /></th>
            <th style={S.thFilter}></th>
            <th style={S.thFilter}></th>
          </tr>
        </thead>
        <tbody>
          {p.runs.length === 0 ? (
            <tr><td style={S.td} colSpan={13}>{p.hasFilter ? 'nessun run (filtrato) — premi Reset' : 'no runs yet — run a backtest from Builder'}</td></tr>
          ) : p.runs.map((r) => {
            const cagr = r.cagr
            const tr = r.total_return
            const md = r.max_drawdown
            const sh = r.sharpe
            const so = r.sortino
            const isExpanded = p.expanded.has(r.id)
            return (
              <tr key={r.id} style={p.sel === r.id ? { background: '#161b22' } : undefined}>
                <td style={{ ...S.td, textAlign: 'center' as const }}><input type="checkbox" checked={p.selected.has(r.id)} onChange={() => p.onToggleOne(r.id)} /></td>
                <td style={S.td}>{r.id}</td>
                <td style={S.td} title={r.strategy_name ?? (r.config as Record<string, unknown>)?.['strategy_name'] as string ?? ''}>{r.strategy_name ?? ((r.config as Record<string, unknown>)?.['strategy_name'] as string | undefined) ?? <span style={{ color: '#8b949e' }}>{r.strategy_id != null ? `— (deleted #${r.strategy_id})` : '—'}</span>}</td>
                <td style={S.td}>{formatCreatedAt(r.created_at)}</td>
                <td style={S.td}>{r.start ?? ''}</td>
                <td style={S.td}>{r.end ?? ''}</td>
                <td style={{ ...S.td, color: (typeof tr === 'number' && tr < 0) ? '#f85149' : (typeof tr === 'number' && tr > 0.1) ? '#3fb950' : '#c9d1d9' }}>{typeof tr === 'number' ? `${(tr * 100).toFixed(2).replace('.', ',')}%` : '—'}</td>
                <td style={{ ...S.td, color: typeof md === 'number' && md < 0 ? '#f85149' : '#c9d1d9' }}>{typeof md === 'number' ? `${(md * 100).toFixed(2).replace('.', ',')}%` : '—'}</td>
                <td style={S.td}>{typeof sh === 'number' ? sh.toFixed(2) : '—'}</td>
                <td style={S.td}>{typeof so === 'number' ? so.toFixed(2) : '—'}</td>
                <td style={{ ...S.td, color: (typeof cagr === 'number' && cagr < 0) ? '#f85149' : (typeof cagr === 'number' && cagr > 0.1) ? '#3fb950' : '#c9d1d9' }}>{r.stats ? (typeof cagr === 'number' ? `${(cagr * 100).toFixed(2).replace('.', ',')}%` : '—') : '—'}</td>
                <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={isExpanded ? S.btnPri : S.btnSmall} onClick={() => p.onToggleExpanded(r.id)}>{isExpanded ? 'Hide' : 'View'}</button></td>
                <td style={{ ...S.td, textAlign: 'center' as const }}><button type="button" style={S.btnDanger} onClick={() => p.onDeleteOne(r.id)}>Delete</button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
