import type { StrategyTree } from '../types/bt'

export const API_BASE = 'http://localhost:8001'
export const WS_BASE = API_BASE.replace(/^http/, 'ws')

export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const btApi = {
  health: () => request<{ status: string }>('/api/bt/health'),
  algos: () => request<unknown[]>('/api/bt/algos'),
}

export type AlgoMeta = { name: string; category: string; doc: string; requires: string | null; sets: string | null }
export type AlgoSchema = { title: string; type: string; properties: Record<string, { type: string; default: unknown }>; required: string[] }
export type StrategyRow = { id: number; name: string; tree: StrategyTree; created_at: string }

export const strategiesApi = {
  list: () => request<StrategyRow[]>('/api/bt/strategies'),
  get: (id: number) => request<StrategyRow>(`/api/bt/strategies/${id}`),
  create: (tree: StrategyTree) => request<StrategyRow>('/api/bt/strategies', { method: 'POST', body: JSON.stringify(tree) }),
  update: (id: number, tree: StrategyTree) => request<StrategyRow>(`/api/bt/strategies/${id}`, { method: 'PUT', body: JSON.stringify(tree) }),
  delete: (id: number) => request<void>(`/api/bt/strategies/${id}`, { method: 'DELETE' }),
}

export const algosApi = {
  list: () => request<AlgoMeta[]>('/api/bt/algos'),
  schema: (name: string) => request<AlgoSchema>(`/api/bt/algos/${encodeURIComponent(name)}/schema`),
}

export type DataSourceRow = { id: number; name: string; type: string; source: string; meta: Record<string, unknown>; path_or_tickers: string }

export const dataApi = {
  list: () => request<DataSourceRow[]>('/api/bt/data-sources'),
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
}

export type RunRow = { id: number; strategy_id: number | null; stats: Record<string, unknown> | null; config: Record<string, unknown>; created_at: string }

export const backtestApi = {
  create: (req: unknown) => request<{ id: number; status: string }>('/api/bt/backtest', { method: 'POST', body: JSON.stringify(req) }),
  listRuns: () => request<RunRow[]>('/api/bt/runs'),
  getRun: (id: number) => request<RunRow & { transactions?: unknown[] }>(`/api/bt/runs/${id}`),
  getPrices: (id: number) => request<{ dates: string[]; values: number[]; weights: Record<string, number[]> }>(`/api/bt/runs/${id}/prices`),
  wsProgress: (id: number) => new WebSocket(`${WS_BASE}/api/bt/backtest/${id}/progress`),
}
