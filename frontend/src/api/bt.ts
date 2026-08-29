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

export type HealthInfo = { status: string; version: string; db: string; db_error: string | null; counts: { strategies: number; data_sources: number; runs: number } }

export const btApi = {
  health: () => request<HealthInfo>('/api/bt/health'),
  stats: () => request<{ strategies: number; data_sources: number; runs: number }>('/api/bt/stats'),
  algos: () => request<unknown[]>('/api/bt/algos'),
}

export const SETTINGS_KEY = 'bt-settings:v1'
export type BtSettings = {
  initial_capital: number
  integer_positions: boolean
  simple_fn: string
  theme: 'dark'
  lang: 'it' | 'en'
  data_adapter: 'ffn' | 'yfinance'
}
export const defaultSettings: BtSettings = {
  initial_capital: 100000,
  integer_positions: false,
  simple_fn: '',
  theme: 'dark',
  lang: 'it',
  data_adapter: 'ffn',
}
export function loadSettings(): BtSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<BtSettings>) }
  } catch {
    /* ignore */
    return defaultSettings
  }
}
export function saveSettings(s: BtSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export type AlgoMeta = { name: string; category: string; doc: string; requires: string | null; sets: string | null }
export type AlgoSchema = { title: string; type: string; properties: Record<string, { type: string; default: unknown }>; required: string[] }
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

export const algosApi = {
  list: () => request<AlgoMeta[]>('/api/bt/algos'),
  schema: (name: string) => request<AlgoSchema>(`/api/bt/algos/${encodeURIComponent(name)}/schema`),
}

export type DataSourceRow = { id: number; name: string; type: string; source: string; meta: Record<string, unknown>; path_or_tickers: string }

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
  computeIndicator: (req: { price_source_id: number; type: string; params: Record<string, unknown>; save?: boolean; name?: string }) =>
    request<{ id: number; name: string; meta: IndicatorMeta }>('/api/bt/indicators/compute', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  getIndicatorDefs: () => request<IndicatorDef[]>('/api/bt/indicators/defs'),
}

export type RunRow = { id: number; strategy_id: number | null; strategy_name: string | null; stats: Record<string, unknown> | null; config: Record<string, unknown>; created_at: string; start: string | null; end: string | null; cagr: number | null; total_return: number | null; max_drawdown: number | null; sharpe: number | null; sortino: number | null }

export const backtestApi = {
  create: (req: unknown) => request<{ id: number; status: string }>('/api/bt/backtest', { method: 'POST', body: JSON.stringify(req) }),
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
  getPrices: (id: number) => request<{ dates: string[]; values: number[]; weights: Record<string, number[]> }>(`/api/bt/runs/${id}/prices`),
  deleteRun: (id: number) => request<void>(`/api/bt/runs/${id}`, { method: 'DELETE' }),
  bulkDeleteRuns: (ids: number[]) =>
    request<{ deleted: number; not_found: number[] }>('/api/bt/runs/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  wsProgress: (id: number) => new WebSocket(`${WS_BASE}/api/bt/backtest/${id}/progress`),
}

// ponytail: BE stores UTC; display in Europe/Rome
export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = String(iso)
  // naive "2026-08-29T10:00:00" -> treat as UTC
  const hasTz = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(hasTz ? s : `${s}Z`)
  if (Number.isNaN(d.getTime())) return s.slice(0, 19)
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export type DbInfo = { active: 'main' | 'test'; dbs: { name: string; file: string; counts: { strategies: number; data_sources: number; runs: number } }[] }

export const dbApi = {
  info: () => request<DbInfo>('/api/bt/db'),
  switch: (db: 'main' | 'test') => request<{ active: string; previous: string }>('/api/bt/db/switch', { method: 'POST', body: JSON.stringify({ db }) }),
}
