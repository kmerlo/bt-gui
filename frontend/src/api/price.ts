import { request } from './request'

export type PriceTickerRow = { symbol: string; interval: string; start: string; end: string; count: number }
export type PriceRow = { date: string; open: number | null; high: number | null; low: number | null; close: number | null; adj_close: number | null; volume: number | null }

export const priceDataApi = {
  list: (opts?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) q.set('offset', String(opts.offset))
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<PriceTickerRow[]>(`/api/bt/price-data${qs}`)
  },
  fetch: (symbol: string, start?: string, end?: string) =>
    request<{ symbol: string; rows: number }>('/api/bt/price-data/fetch', {
      method: 'POST',
      body: JSON.stringify({ symbol, start, end }),
    }),
  getRows: (symbol: string, opts?: { start?: string; end?: string; sort_by?: string; sort_dir?: 'asc' | 'desc'; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (opts?.start) q.set('start', opts.start)
    if (opts?.end) q.set('end', opts.end)
    if (opts?.sort_by) q.set('sort_by', opts.sort_by)
    if (opts?.sort_dir) q.set('sort_dir', opts.sort_dir)
    if (opts?.search) q.set('search', opts.search)
    if (opts?.limit !== undefined) q.set('limit', String(opts.limit))
    if (opts?.offset !== undefined) q.set('offset', String(opts.offset))
    const qs = q.toString() ? `?${q.toString()}` : ''
    return request<PriceRow[]>(`/api/bt/price-data/${encodeURIComponent(symbol)}/rows${qs}`)
  },
  delete: (symbol: string) => request<void>(`/api/bt/price-data/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
}
