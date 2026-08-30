import { request } from './request'

export type AlgoMeta = { name: string; category: string; doc: string; requires: string | null; sets: string | null }
export type AlgoSchema = { title: string; type: string; properties: Record<string, { type: string; default: unknown }>; required: string[] }

export const algosApi = {
  list: () => request<AlgoMeta[]>('/api/bt/algos'),
  schema: (name: string) => request<AlgoSchema>(`/api/bt/algos/${encodeURIComponent(name)}/schema`),
}
