import { useState } from 'react'
import { backtestApi } from '../../api/bt'
import { QUANT_PLOT_KINDS, useQuantStats } from '../../hooks/useQuantStats'

const S = {
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
  btnActive: { background: '#1f6feb', color: '#fff', border: '1px solid #1f6feb', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
}

function fmt(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(4)
}

export default function QuantStatsPanel({ runId }: { runId: number }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'metrics' | 'plot' | 'tearsheet'>('metrics')
  const q = useQuantStats(runId)

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !q.data) q.loadMetrics()
  }
  const pickTab = (t: 'metrics' | 'plot' | 'tearsheet') => {
    setTab(t)
    if (t === 'metrics' && !q.data) q.loadMetrics()
    if (t === 'plot' && !q.png) q.loadPlot(q.plotKind)
  }

  return (
    <div style={S.card}>
      <button type="button" style={S.btn} onClick={toggle}>{open ? '▼' : '▶'} QuantStats {q.data?.benchmark_ticker ? `· vs ${q.data.benchmark_ticker}` : ''}</button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {(['metrics', 'plot', 'tearsheet'] as const).map((t) => (
              <button key={t} type="button" style={tab === t ? S.btnActive : S.btn} onClick={() => pickTab(t)}>
                {t === 'metrics' ? 'Metriche extra' : t === 'plot' ? 'Plot' : 'Tearsheet completo'}
              </button>
            ))}
            {tab === 'tearsheet' && (
              <a style={{ ...S.btn, textDecoration: 'none', display: 'inline-block' }} href={`${backtestApi.quantTearsheetUrl(runId)}?download=true`} target="_blank" rel="noreferrer">⬇ HTML</a>
            )}
          </div>
          {q.loading && <div style={{ fontSize: 12, color: '#8b949e' }}>calcolo…</div>}
          {q.error && <div style={{ fontSize: 12, color: '#f85149' }}>{q.error}</div>}
          {tab === 'metrics' && q.data && (
            <table style={S.table}><tbody>
              {Object.entries(q.data.metrics).map(([k, v]) => (
                <tr key={k}><td style={S.td}>{k}</td><td style={S.td}>{fmt(v)}</td></tr>
              ))}
            </tbody></table>
          )}
          {tab === 'plot' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                {QUANT_PLOT_KINDS.map((k) => (
                  <button key={k} type="button" style={q.plotKind === k ? S.btnActive : S.btn} onClick={() => q.loadPlot(k)}>{k}</button>
                ))}
              </div>
              {q.png && <img alt={`quantstats ${q.plotKind}`} src={`data:image/png;base64,${q.png}`} style={{ maxWidth: '100%' }} />}
            </>
          )}
          {tab === 'tearsheet' && (
            <iframe title={`quantstats tearsheet #${runId}`} src={backtestApi.quantTearsheetUrl(runId)} style={{ width: '100%', height: 800, border: '1px solid #30363d', borderRadius: 6, background: '#fff' }} />
          )}
        </div>
      )}
    </div>
  )
}
