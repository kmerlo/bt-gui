import { useRunsTable } from '../../hooks/useRunsTable'
import { useRunDetail } from '../../hooks/useRunDetail'
import { useEquityCharts } from '../../hooks/useEquityCharts'
import RunsTable from './RunsTable'
import MetricsPanel from './MetricsPanel'
import TransactionsTable from './TransactionsTable'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 12 } as const,
  msgOk: { fontSize: 12, color: '#3fb950', marginBottom: 8 } as const,
  msgErr: { fontSize: 12, color: '#f85149', marginBottom: 8 } as const,
}

export default function ResultsDashboard({ runId }: { runId: number | null }) {
  const t = useRunsTable()
  const d = useRunDetail(runId)
  const charts = useEquityCharts(d.prices)

  const handleDeleteOne = async (id: number) => {
    const ok = await t.handleDeleteOne(id)
    if (ok) d.clearIfDeleted(new Set([id]))
  }
  const handleBulkDelete = async () => {
    const deleted = await t.handleBulkDelete()
    if (deleted.size > 0) d.clearIfDeleted(deleted)
  }

  return (
    <div style={S.wrap}>
      <style>{`@keyframes bt-progress{0%{transform:translateX(-100%)}50%{transform:translateX(150%)}100%{transform:translateX(-100%)}}`}</style>
      <h3 style={{ margin: '0 0 12px' }}>Results</h3>
      {t.hasRunning && <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>⏳ {t.runs.filter((r) => r.stats == null).length} run in esecuzione — aggiornamento automatico ogni 1,5s</div>}
      <div style={S.row}>
        <input style={S.input} placeholder="cerca globale" value={t.searchDraft} onChange={(e) => t.setSearchDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') t.setSearch(t.searchDraft) }} />
        <button type="button" style={S.btn} onClick={() => t.setSearch(t.searchDraft)}>Filtra</button>
        {t.hasFilter && <button type="button" style={S.btn} onClick={t.resetFilters}>Reset</button>}
        <button type="button" style={S.btn} onClick={t.refresh}>Refresh</button>
        <span style={{ fontSize: 12, color: '#8b949e' }}>{t.runs.length} run{t.search || t.fId || t.fCreatedAt || t.fStart || t.fEnd || t.fStats ? ' (filtrati)' : ''}{t.selected.size > 0 ? ` · selezionati: ${t.selected.size}` : ''}{d.expanded.size > 0 ? ` · espansi: ${d.expanded.size}` : ''}{d.sel ? ` · selezionato: #${d.sel}` : ''}</span>
      </div>
      {t.selected.size > 0 && (
        <div style={{ ...S.row, marginBottom: 8 }}>
          <button type="button" style={S.btnDanger} onClick={handleBulkDelete}>Elimina selezionati ({t.selected.size})</button>
          <button type="button" style={S.btn} onClick={() => t.setSelected(new Set())}>Deseleziona</button>
        </div>
      )}
      {t.msg && <div style={t.msg.startsWith('[ok]') ? S.msgOk : S.msgErr}>{t.msg}</div>}
      <RunsTable
        runs={t.runs} sel={d.sel} expanded={d.expanded} selected={t.selected} sortBy={t.sortBy} sortDir={t.sortDir}
        allChecked={t.allChecked} hasFilter={t.hasFilter} fId={t.fId} fStrategyName={t.fStrategyName} fCreatedAt={t.fCreatedAt} fStart={t.fStart} fEnd={t.fEnd} fTotalReturn={t.fTotalReturn} fMaxDrawdown={t.fMaxDrawdown} fSharpe={t.fSharpe} fSortino={t.fSortino} fStats={t.fStats}
        onSort={t.handleSort} sortIcon={t.sortIcon} onToggleOne={t.toggleOne} onToggleAll={t.toggleAll} onToggleExpanded={d.toggleExpanded} onDeleteOne={handleDeleteOne}
        setFId={t.setFId} setFStrategyName={t.setFStrategyName} setFCreatedAt={t.setFCreatedAt} setFStart={t.setFStart} setFEnd={t.setFEnd} setFTotalReturn={t.setFTotalReturn} setFMaxDrawdown={t.setFMaxDrawdown} setFSharpe={t.setFSharpe} setFSortino={t.setFSortino} setFStats={t.setFStats}
      />
      {!d.sel && t.runs.length > 0 && <div style={{ color: '#8b949e', fontSize: 13 }}>seleziona un run dalla tabella per vedere i dettagli</div>}
      {d.sel && (
        <>
          <div style={S.card}><div style={{ fontWeight: 700, marginBottom: 8 }}>Equity Curve {d.sel ? `#${d.sel}` : ''}</div><div ref={charts.chartRef} style={{ width: '100%', height: 260 }} /></div>
          <div style={S.card}><div style={{ fontWeight: 700, marginBottom: 8 }}>Drawdown (%)</div><div ref={charts.ddRef} style={{ width: '100%', height: 160 }} /></div>
          {d.stats && <MetricsPanel stats={d.stats} />}
          {d.tx.length > 0 && <TransactionsTable tx={d.tx} />}
        </>
      )}
    </div>
  )
}
