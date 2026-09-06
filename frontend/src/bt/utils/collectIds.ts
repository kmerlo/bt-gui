import type { NodeConfig, StrategyTree } from '../../types/bt'

// ponytail: unica fonte per "IDs usati dalla strategia" — params algo numerici
// (stessa euristica di RunDialog/AlgoStack: i ref indicatore/segnale sono stringhe
// numeriche) + liste preset già salvate. Ritorna IDs unici ordinati.
export function collectReferencedIds(tree: StrategyTree | null | undefined): number[] {
  if (!tree) return []
  const ids = new Set<number>()
  const walk = (node: NodeConfig | null | undefined): void => {
    if (!node) return
    for (const a of node.algos ?? []) {
      const params = a.params as Record<string, unknown> | undefined
      if (params) {
        for (const v of Object.values(params)) {
          if (typeof v === 'string' && /^\d+$/.test(v.trim())) ids.add(Number(v))
        }
      }
    }
    for (const c of node.children ?? []) walk(c)
  }
  walk(tree.root)
  const preset = tree.preset as unknown as
    | { indicator_source_ids?: unknown; signal_source_ids?: unknown }
    | null
    | undefined
  for (const key of ['indicator_source_ids', 'signal_source_ids'] as const) {
    const list = preset?.[key]
    if (Array.isArray(list)) {
      for (const v of list) if (typeof v === 'number' && Number.isInteger(v)) ids.add(v)
    }
  }
  return [...ids].sort((a, b) => a - b)
}
