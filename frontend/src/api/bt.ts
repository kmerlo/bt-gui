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
  return res.json()
}

export const btApi = {
  health: () => request<{ status: string }>('/api/bt/health'),
  algos: () => request<unknown[]>('/api/bt/algos'),
}
