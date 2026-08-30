// ponytail: BE stores UTC; display in Europe/Rome
export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = String(iso)
  const hasTz = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(hasTz ? s : `${s}Z`)
  if (Number.isNaN(d.getTime())) return s.slice(0, 19)
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
