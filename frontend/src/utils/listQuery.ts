export function applySearch<T>(rows: T[], q: string, fields: (keyof T)[]): T[] {
  const ql = q.toLowerCase()
  return rows.filter((r) => fields.some((f) => String((r as Record<string, unknown>)[f as string] ?? '').toLowerCase().includes(ql)))
}

export function applySort<T>(rows: T[], sortBy: string | null, sortDir: 'asc' | 'desc'): T[] {
  if (!sortBy) return rows
  const dir = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortBy]
    const bv = (b as Record<string, unknown>)[sortBy]
    if (av == null && bv == null) return 0
    if (av == null) return 1 * dir
    if (bv == null) return -1 * dir
    return String(av).localeCompare(String(bv)) * dir
  })
}
