import { useCallback, useState } from 'react'
import { backtestApi, type QuantPlotKind, type QuantStatsResponse } from '../api/runs'

export const QUANT_PLOT_KINDS: QuantPlotKind[] = ['snapshot', 'monthly_heatmap', 'drawdown', 'distribution']

export function useQuantStats(runId: number) {
  const [data, setData] = useState<QuantStatsResponse | null>(null)
  const [plotKind, setPlotKind] = useState<QuantPlotKind>('snapshot')
  const [png, setPng] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMetrics = useCallback(() => {
    setLoading(true)
    setError(null)
    backtestApi.getQuantStats(runId).then(setData).catch(() => setError('quantstats non disponibile per questo run')).finally(() => setLoading(false))
  }, [runId])

  const loadPlot = useCallback((kind: QuantPlotKind) => {
    setPlotKind(kind)
    setPng(null)
    setError(null)
    backtestApi.getQuantPlot(runId, kind).then((r) => setPng(r.png_base64)).catch(() => setError('plot non generabile (serie troppo corta?)'))
  }, [runId])

  return { data, plotKind, png, loading, error, loadMetrics, loadPlot }
}
