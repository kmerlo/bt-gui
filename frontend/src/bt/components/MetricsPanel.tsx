import { useMemo, useState } from 'react'

const S = {
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13 } as const,
  td: { border: '1px solid #30363d', padding: 6, whiteSpace: 'nowrap' as const } as const,
  btnSmall: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 } as const,
}

const PERCENT_KEYS = new Set([
  'rf', 'total_return', 'cagr', 'max_drawdown', 'max_dd',
  'mtd', 'three_month', 'six_month', 'ytd', 'one_year', 'three_year', 'five_year', 'ten_year', 'incep',
  'daily_mean', 'daily_vol', 'best_day', 'worst_day',
  'monthly_mean', 'monthly_vol', 'best_month', 'worst_month',
  'yearly_mean', 'yearly_vol', 'best_year', 'worst_year',
  'avg_drawdown', 'avg_up_month', 'avg_down_month', 'win_year_perc', 'twelve_month_win_perc',
])
const METRIC_GROUPS: { id: string; label: string; match: (_k: string) => boolean }[] = [
  { id: 'daily', label: 'Daily', match: (k) => k.includes('daily') || k === 'best_day' || k === 'worst_day' },
  { id: 'monthly', label: 'Monthly', match: (k) => k.includes('monthly') || ['best_month', 'worst_month', 'avg_up_month', 'avg_down_month', 'twelve_month_win_perc'].includes(k) },
  { id: 'yearly', label: 'Yearly', match: (k) => k.includes('yearly') || ['best_year', 'worst_year', 'win_year_perc', 'one_year', 'three_year', 'five_year', 'ten_year', 'incep'].includes(k) },
]
function formatMetric(key: string, v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (PERCENT_KEYS.has(key.toLowerCase())) return `${(v * 100).toFixed(2).replace('.', ',')}%`
    return v.toFixed(4)
  }
  return String(v).slice(0, 120)
}

type Props = { stats: Record<string, unknown> }

export default function MetricsPanel({ stats }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const grouped = useMemo(() => {
    const entries = Object.entries(stats)
    const used = new Set<string>()
    const groups = METRIC_GROUPS.map((g) => {
      const rows = entries.filter(([k]) => g.match(k.toLowerCase()))
      for (const [k] of rows) used.add(k)
      return { ...g, rows }
    })
    const otherRows = entries.filter(([k]) => !used.has(k))
    return { groups, otherRows }
  }, [stats])
  return (
    <div style={S.card}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Metrics</div>
      <table style={S.table}>
        {grouped.otherRows.length > 0 && (
          <tbody>
            <tr><td colSpan={2} style={{ ...S.td, background: '#161b22', padding: 4 }}><button type="button" style={S.btnSmall} onClick={() => setCollapsed((s) => ({ ...s, _other: !s._other }))}>{collapsed._other ? '▶' : '▼'} Altro ({grouped.otherRows.length})</button></td></tr>
            {!collapsed._other && grouped.otherRows.map(([k, v]) => (
              <tr key={k}><td style={S.td}>{k}</td><td style={S.td} title={typeof v === 'number' ? String(v) : undefined}>{formatMetric(k, v)}</td></tr>
            ))}
          </tbody>
        )}
        {grouped.groups.map((g) => (
          <tbody key={g.id}>
            <tr><td colSpan={2} style={{ ...S.td, background: '#161b22', padding: 4 }}><button type="button" style={S.btnSmall} onClick={() => setCollapsed((s) => ({ ...s, [g.id]: !s[g.id] }))}>{collapsed[g.id] ? '▶' : '▼'} {g.label} ({g.rows.length})</button></td></tr>
            {!collapsed[g.id] && g.rows.map(([k, v]) => (
              <tr key={k}><td style={S.td}>{k}</td><td style={S.td} title={typeof v === 'number' ? String(v) : undefined}>{formatMetric(k, v)}</td></tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
