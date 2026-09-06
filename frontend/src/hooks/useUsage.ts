import { useEffect, useState } from 'react'
import { dataApi } from '../api/bt'
import type { UsageResponse } from '../types/bt'

// Mappa id → nomi strategie che li referenziano (BE: GET /api/bt/usage).
// Ritorna null se non disponibile — le tabelle restano usabili con '—'.
export function useUsage(): UsageResponse | null {
  const [usage, setUsage] = useState<UsageResponse | null>(null)
  useEffect(() => {
    dataApi.usage().then(setUsage).catch(() => { /* colonna Strategia resta '—' */ })
  }, [])
  return usage
}
