import { request } from './request'

export type TaxProfile = { id: number; name: string; gain_rate: number; div_rate: number }
export type TaxProfileIn = { name: string; gain_rate: number; div_rate: number }

export const taxProfilesApi = {
  list: () => request<TaxProfile[]>('/api/bt/tax-profiles'),
  create: (p: TaxProfileIn) => request<TaxProfile>('/api/bt/tax-profiles', { method: 'POST', body: JSON.stringify(p) }),
  update: (id: number, p: TaxProfileIn) => request<TaxProfile>(`/api/bt/tax-profiles/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  remove: (id: number) => request<void>(`/api/bt/tax-profiles/${id}`, { method: 'DELETE' }),
}
