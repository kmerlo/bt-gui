import { useRunsTable } from '../../hooks/useRunsTable'
import { useRunDetail } from '../../hooks/useRunDetail'
import { useEquityCharts } from '../../hooks/useEquityCharts'
import { useWeightsChart } from '../../hooks/useWeightsChart'
import { useCompareCharts } from '../../hooks/useCompareCharts'
import { loadSettings } from '../../api/settings'
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
  const wCharts = useWeightsChart(d.weights)
  const cmp = useCompareCharts()

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
          <div style={S.card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Weights (%) {d.weights ? `· ${Object.keys(d.weights.series).length} serie` : ''}</div>
            {d.weights ? (
              <>
                <div ref={wCharts.ref} style={{ width: '100%', height: 200 }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                  {wCharts.keys.map((k, i) => {
                    const color = wCharts.palette[i % wCharts.palette.length]
                    const isHidden = wCharts.hidden.has(k)
                    return (
                      <button key={k} type="button" onClick={() => wCharts.toggle(k)} title={isHidden ? `Mostra ${k}` : `Nascondi ${k}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: isHidden ? '#161b22' : '#21262d', color: isHidden ? '#8b949e' : '#c9d1d9', border: `1px solid ${isHidden ? '#30363d' : color}`, borderRadius: 12, padding: '3px 8px', cursor: 'pointer', fontSize: 12, opacity: isHidden ? 0.6 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, opacity: isHidden ? 0.35 : 1, display: 'inline-block' }} />
                        {k}
                      </button>
                    )
                  })}
                  {wCharts.keys.length > 1 && (
                    <>
                      <span style={{ width: 1, height: 16, background: '#30363d', display: 'inline-block' }} />
                      <button type="button" style={{ ...S.btn, padding: '3px 8px', fontSize: 12 }} onClick={wCharts.showAll}>Mostra tutte</button>
                      <button type="button" style={{ ...S.btn, padding: '3px 8px', fontSize: 12 }} onClick={wCharts.hideAll}>Nascondi tutte</button>
                    </>
                  )}
                </div>
              </>
            ) : <div style={{ fontSize: 12, color: '#8b949e' }}>Nessun dato pesi per questo run (strategia single-asset o run vecchio senza weights_parquet).</div>}
          </div>
          {d.stats && <MetricsPanel stats={d.stats} />}
          {d.tx.length > 0 && <TransactionsTable tx={d.tx} settings={loadSettings()} />}
        </>
      )}
      {/* Compare overlay — normalizzato a 100, come res.plot() dell'esempio Strategy Combination */}
      <div style={S.card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Confronto equity singole (normalizzato a 100) — replica Strategy Combination</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>Seleziona 2+ run con ☑ nella tabella, poi premi “Confronta selezionati”. Utile per confrontare EW vs InvVol vs Combined (var. B merged prices).</div>
        <div style={S.row}>
          <button type="button" style={S.btn} disabled={t.selected.size < 1} onClick={() => {
            const ids = [...t.selected]
            const names: Record<number, string> = {}
            for (const r of t.runs) if (ids.includes(r.id)) names[r.id] = r.strategy_name ?? `#${r.id}`
            cmp.load(ids, names)
          }}>Confronta selezionati ({t.selected.size})</button>
          {cmp.series.length > 0 && <button type="button" style={S.btn} onClick={cmp.clear}>Pulisci</button>}
          {cmp.loading && <span style={{ fontSize: 12, color: '#8b949e' }}>caricamento…</span>}
        </div>
        {cmp.series.length > 0 && (
          <>
            <div ref={cmp.ref} style={{ width: '100%', height: 260 }} />
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {cmp.series.map((s, i) => <span key={s.id} style={{ color: ['#58a6ff', '#f85149', '#3fb950', '#d29922', '#bc8cff'][i % 5] }}>● {s.name} #{s.id}</span>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
