import type { BenchmarkStats } from '../../api/bt'

const S = {
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
}

function pct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(2).replace('.', ',')}%` : '—'
}
function num(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(4) : '—'
}
function tone(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '#c9d1d9'
  return v >= 0 ? '#3fb950' : '#f85149'
}

type Props = { ticker: string | null; stats: BenchmarkStats | null }

export default function BenchmarkPanel({ ticker, stats }: Props) {
  if (!ticker) return null
  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Benchmark <span style={{ color: '#d29922' }}>{ticker}</span> buy&amp;hold
        {!stats && <span style={{ fontWeight: 400, fontSize: 12, color: '#8b949e' }}> — nessun dato: fetch in Ticker Catalog</span>}
      </div>
      {stats && (
        <table style={S.table}>
          <tbody>
            <tr><td style={S.td}>Total Return bench</td><td style={{ ...S.td, color: tone(stats.benchmark_total_return) }}>{pct(stats.benchmark_total_return)}</td></tr>
            <tr><td style={S.td}>CAGR bench</td><td style={{ ...S.td, color: tone(stats.benchmark_cagr) }}>{pct(stats.benchmark_cagr)}</td></tr>
            <tr><td style={S.td}>Max DD bench</td><td style={S.td}>{pct(stats.benchmark_max_drawdown)}</td></tr>
            <tr><td style={S.td}>Outperformance (TR strat − bench)</td><td style={{ ...S.td, color: tone(stats.outperformance), fontWeight: 700 }}>{pct(stats.outperformance)}</td></tr>
            <tr><td style={S.td}>Outperformance CAGR</td><td style={{ ...S.td, color: tone(stats.outperformance_cagr) }}>{pct(stats.outperformance_cagr)}</td></tr>
            <tr><td style={S.td}>Alpha (ann.)</td><td style={{ ...S.td, color: tone(stats.alpha) }}>{num(stats.alpha)}</td></tr>
            <tr><td style={S.td}>Beta</td><td style={S.td}>{num(stats.beta)}</td></tr>
            <tr><td style={S.td}>Correlation</td><td style={S.td}>{num(stats.correlation)}</td></tr>
            <tr><td style={S.td}>Tracking error (ann.)</td><td style={S.td}>{num(stats.tracking_error)}</td></tr>
            <tr><td style={S.td}>Information ratio</td><td style={{ ...S.td, color: tone(stats.information_ratio) }}>{num(stats.information_ratio)}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  )
}
