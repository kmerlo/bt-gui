import type { StrategyTree } from '../types/bt'
import { request } from './request'

export type StrategyRow = { id: number; name: string; tree: StrategyTree; created_at: string }

export const strategiesApi = {
  list: (opts?: { search?: string; sort_by?: string; sort_dir?: string; filter_id?: string; filter_name?: string; filter_created_at?: string }) => {
    const q = new URLSearchParams()
    if (opts?.search) q.set('search', opts.search)
    if (opts?.sort_by) q.set('sort_by', opts.sort_by)
    if (opts?.sort_dir) q.set('sort_dir', opts.sort_dir)
    if (opts?.filter_id) q.set('filter_id', opts.filter_id)
    if (opts?.filter_name) q.set('filter_name', opts.filter_name)
    if (opts?.filter_created_at) q.set('filter_created_at', opts.filter_created_at)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<StrategyRow[]>(`/api/bt/strategies${qs}`)
  },
  get: (id: number) => request<StrategyRow>(`/api/bt/strategies/${id}`),
  create: (tree: StrategyTree) => request<StrategyRow>('/api/bt/strategies', { method: 'POST', body: JSON.stringify(tree) }),
  update: (id: number, tree: StrategyTree) => request<StrategyRow>(`/api/bt/strategies/${id}`, { method: 'PUT', body: JSON.stringify(tree) }),
  delete: (id: number) => request<void>(`/api/bt/strategies/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: number[]) =>
    request<{ deleted: number; not_found: number[] }>('/api/bt/strategies/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
}
