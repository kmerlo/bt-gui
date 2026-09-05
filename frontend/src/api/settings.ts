export const SETTINGS_KEY = 'bt-settings:v1'
export type BtSettings = {
  initial_capital: number
  integer_positions: boolean
  simple_fn: string
  price_column: 'close' | 'adj_close'
  theme: 'dark'
  lang: 'it' | 'en'
  data_adapter: 'ffn' | 'yfinance'
  price_source: 'local' | 'market'
  tx_group_bg_color: string
  tx_group_bg_opacity: number
}
export const defaultSettings: BtSettings = {
  initial_capital: 100000,
  integer_positions: false,
  simple_fn: '',
  price_column: 'adj_close',
  theme: 'dark',
  lang: 'it',
  data_adapter: 'ffn',
  price_source: 'local',
  tx_group_bg_color: '#161b22',
  tx_group_bg_opacity: 0.15,
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

export type HealthInfo = { status: string; version: string; db: string; db_error: string | null; counts: { strategies: number; data_sources: number; runs: number }; price_source: string }
export type DbInfo = { active: 'main' | 'test'; dbs: { name: string; file: string; counts: { strategies: number; data_sources: number; runs: number } }[] }

import { request } from './request'
export const btApi = {
  health: () => request<HealthInfo>('/api/bt/health'),
  stats: () => request<{ strategies: number; data_sources: number; runs: number }>('/api/bt/stats'),
  algos: () => request<unknown[]>('/api/bt/algos'),
}
export const dbApi = {
  info: () => request<DbInfo>('/api/bt/db'),
  switch: (db: 'main' | 'test') => request<{ active: string; previous: string }>('/api/bt/db/switch', { method: 'POST', body: JSON.stringify({ db }) }),
}
export const priceSourceApi = {
  get: () => request<{ source: string }>('/api/bt/settings/price-source'),
  set: (source: 'local' | 'market') => request<{ source: string }>('/api/bt/settings/price-source', { method: 'POST', body: JSON.stringify({ source }) }),
}
