import { API_BASE, request } from './request'
import type { PriceTickerRow } from './price'

export type DataSourceRow = { id: number; name: string; type: string; source: string; meta: Record<string, unknown>; path_or_tickers: string }

export type UnifiedDataList = {
  adapter: 'yfinance'
  sources: DataSourceRow[]
  prices: PriceTickerRow[]
}

export type UnifiedDataFetch =
  | { adapter: 'ffn'; id: number; name: string; rows: number }
  | { adapter: 'yfinance'; symbol: string; rows: number }

export type IndicatorDef = {
  type: string
  display: string
  params: { name: string; type: string; default: unknown }[]
  output_key: string
}

export type IndicatorMeta = {
  indicator_type: string
  params: Record<string, unknown>
}

export const dataApi = {
  list: (opts?: { search?: string; sort_by?: string; sort_dir?: string }) => {
    const q = new URLSearchParams()
    if (opts?.search) q.set('search', opts.search)
    if (opts?.sort_by) q.set('sort_by', opts.sort_by)
    if (opts?.sort_dir) q.set('sort_dir', opts.sort_dir)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<DataSourceRow[]>(`/api/bt/data-sources${qs}`)
  },
  upload: (name: string, type: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${API_BASE}/api/bt/data-sources/upload?name=${encodeURIComponent(name)}&type=${type}`, { method: 'POST', body: fd }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text())
      return r.json() as Promise<{ id: number; name: string; meta: Record<string, unknown> }>
    })
  },
  fetchFfn: (name: string, type: string, tickers: string[], start: string, end: string) =>
    request<{ id: number; name: string; meta: Record<string, unknown> }>('/api/bt/data-sources/fetch', {
      method: 'POST',
      body: JSON.stringify({ name, type, tickers, start, end }),
    }),
  preview: (id: number) => request<{ columns: string[]; rows: Record<string, unknown>[]; shape: number[] }>(`/api/bt/data-sources/${id}/preview`),
  table: (id: number, opts?: { limit?: number; offset?: number; sort_by?: string; sort_dir?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) q.set('offset', String(opts.offset))
    if (opts?.sort_by) q.set('sort_by', opts.sort_by)
    if (opts?.sort_dir) q.set('sort_dir', opts.sort_dir)
    if (opts?.search) q.set('search', opts.search)
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<{ columns: string[]; rows: Record<string, unknown>[]; total: number; shape: number[]; filtered_shape: number[]; offset: number; limit: number }>(`/api/bt/data-sources/${id}/table${qs}`)
  },
  delete: (id: number) => request<void>(`/api/bt/data-sources/${id}`, { method: 'DELETE' }),
  bulkDelete: (ids: number[]) =>
    request<{ deleted: number; not_found: number[] }>('/api/bt/data-sources/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  deleteRows: (id: number, dates: string[]) =>
    request<{ deleted: number; remaining: number; shape: number[] }>(`/api/bt/data-sources/${id}/rows/delete`, {
      method: 'POST',
      body: JSON.stringify({ dates }),
    }),
  listIndicators: () => request<DataSourceRow[]>('/api/bt/indicators'),
  computeIndicator: (req: { symbol: string; start?: string; end?: string; type: string; params: Record<string, unknown>; save?: boolean; name?: string }) =>
    request<{ id: number; name: string; meta: IndicatorMeta }>('/api/bt/indicators/compute', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  getIndicatorDefs: () => request<IndicatorDef[]>('/api/bt/indicators/defs'),
  // unified adapter-aware endpoints (B2)
  fetch: (adapter: 'ffn' | 'yfinance', params: { tickers?: string[]; symbol?: string; name?: string; type?: string; start?: string; end?: string }) =>
    request<UnifiedDataFetch>('/api/bt/data/fetch', {
      method: 'POST',
      body: JSON.stringify({ adapter, ...params }),
    }),
  listUnified: () => request<UnifiedDataList>('/api/bt/data/list'),
}
