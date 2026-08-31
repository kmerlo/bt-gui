import { WS_BASE, request } from './request'

export type RunRow = { id: number; strategy_id: number | null; strategy_name: string | null; stats: Record<string, unknown> | null; config: Record<string, unknown>; created_at: string; start: string | null; end: string | null; cagr: number | null; total_return: number | null; max_drawdown: number | null; sharpe: number | null; sortino: number | null }

export const backtestApi = {
  create: (req: unknown) => request<{ id: number; status: string; warnings?: string[] }>('/api/bt/backtest', { method: 'POST', body: JSON.stringify(req) }),
  listRuns: (opts?: { search?: string; sort_by?: string; sort_dir?: string; filter_id?: string; filter_strategy_id?: string; filter_strategy_name?: string; filter_created_at?: string; filter_start?: string; filter_end?: string; filter_total_return?: string; filter_max_drawdown?: string; filter_sharpe?: string; filter_sortino?: string; filter_stats?: string }) => {
    const q = new URLSearchParams()
    if (opts?.search) q.set('search', opts.search)
    if (opts?.sort_by) q.set('sort_by', opts.sort_by)
    if (opts?.sort_dir) q.set('sort_dir', opts.sort_dir)
    if (opts?.filter_id) q.set('filter_id', opts.filter_id)
    if (opts?.filter_strategy_id) q.set('filter_strategy_id', opts.filter_strategy_id)
    if (opts?.filter_strategy_name) q.set('filter_strategy_name', opts.filter_strategy_name)
    if (opts?.filter_created_at) q.set('filter_created_at', opts.filter_created_at)
    if (opts?.filter_start) q.set('filter_start', opts.filter_start)
    if (opts?.filter_end) q.set('filter_end', opts.filter_end)
    if (opts?.filter_total_return) q.set('filter_total_return', opts.filter_total_return)
    if (opts?.filter_max_drawdown) q.set('filter_max_drawdown', opts.filter_max_drawdown)
    if (opts?.filter_sharpe) q.set('filter_sharpe', opts.filter_sharpe)
    if (opts?.filter_sortino) q.set('filter_sortino', opts.filter_sortino)
    if (opts?.filter_stats) q.set('filter_stats', opts.filter_stats)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<RunRow[]>(`/api/bt/runs${qs}`)
  },
  getRun: (id: number) => request<RunRow & { transactions?: unknown[] }>(`/api/bt/runs/${id}`),
  getPrices: (id: number, opts?: { start?: string; end?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (opts?.start) q.set('start', opts.start)
    if (opts?.end) q.set('end', opts.end)
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) q.set('offset', String(opts.offset))
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<{ dates: string[]; values: number[]; weights: Record<string, number[]>; total: number; offset: number; limit: number }>(`/api/bt/runs/${id}/prices${qs}`)
  },
  deleteRun: (id: number) => request<void>(`/api/bt/runs/${id}`, { method: 'DELETE' }),
  bulkDeleteRuns: (ids: number[]) =>
    request<{ deleted: number; not_found: number[] }>('/api/bt/runs/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  wsProgress: (id: number) => new WebSocket(`${WS_BASE}/api/bt/backtest/${id}/progress`),
}
