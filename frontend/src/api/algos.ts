import { request } from './request'

export type AlgoMeta = { name: string; category: string; doc: string; requires: string | null; sets: string | null; param_docs: Record<string, string> }
export type AlgoSchema = { title: string; type: string; properties: Record<string, { type: string; default: unknown }>; required: string[] }

export const algosApi = {
  list: () => request<AlgoMeta[]>('/api/bt/algos'),
  schema: (name: string) => request<AlgoSchema>(`/api/bt/algos/${encodeURIComponent(name)}/schema`),
  validate: (name: string, params: Record<string, unknown>, tickers?: string[]) =>
    request<string[]>(`/api/bt/algos/${encodeURIComponent(name)}/validate`, {
      method: 'POST',
      body: JSON.stringify({ params, available_tickers: tickers ?? [] }),
    }),
}

