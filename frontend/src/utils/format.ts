export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = String(iso).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })
}

export function parseDateIT(s: string): string | null {
  const t = String(s).trim()
  if (!t) return null
  // already ISO
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return null
    if (d.getUTCFullYear() !== Number(iso[1]) || d.getUTCMonth() + 1 !== Number(iso[2]) || d.getUTCDate() !== Number(iso[3])) return null
    return `${iso[1]}-${iso[2]}-${iso[3]}`
  }
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (!m) return null
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  const yyyy = m[3]
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCFullYear() !== Number(yyyy) || d.getUTCMonth() + 1 !== Number(mm) || d.getUTCDate() !== Number(dd)) return null
  return `${yyyy}-${mm}-${dd}`
}

// ponytail: BE stores UTC; display in Europe/Rome
export function formatCreatedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = String(iso)
  const hasTz = s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)
  const d = new Date(hasTz ? s : `${s}Z`)
  if (Number.isNaN(d.getTime())) return s.slice(0, 19)
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
