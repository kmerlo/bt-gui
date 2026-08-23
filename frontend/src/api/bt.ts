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
