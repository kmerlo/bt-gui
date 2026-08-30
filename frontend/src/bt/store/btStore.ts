import { create } from 'zustand'
import type { StrategyTree, NodeConfig } from '../../types/bt'
import { loadStoredPreset, saveStoredPreset, defaultPreset } from './preset'
import type { BuilderBacktestConfig } from './preset'
import { findNode, updateNodeRec, addChildRec, removeRec, insertAtRec } from './treeOps'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

type RunMeta = { id: number; strategy_id: number | null; stats: Record<string, unknown> | null }

export type BtStore = {
  tree: StrategyTree | null
  selectedId: string | null
  runs: RunMeta[]
  selectedRunId: number | null
  showIndicators: boolean
  tickerStart: string | null
  tickerEnd: string | null
  priceColumn: 'close' | 'adj_close'
  extraSourceIds: Record<string, number>
  indicatorSourceIds: number[]
  backtestConfig: BuilderBacktestConfig
  setTree: (t: StrategyTree) => void
  setSelected: (id: string | null) => void
  setRuns: (r: RunMeta[]) => void
  setSelectedRun: (id: number | null) => void
  toggleIndicators: () => void
  setTickerStart: (v: string) => void
  setTickerEnd: (v: string) => void
  setPriceColumn: (v: 'close' | 'adj_close') => void
  setExtraSourceIds: (m: Record<string, number>) => void
  setIndicatorSourceIds: (ids: number[]) => void
  setBacktestConfig: (c: Partial<BuilderBacktestConfig>) => void
  updateNode: (id: string, patch: Partial<NodeConfig>) => void
  addChild: (parentId: string, node: NodeConfig) => void
  removeNode: (id: string) => void
  moveNode: (id: string, newParentId: string, index: number) => void
}

const _stored = loadStoredPreset()
const _defPreset = defaultPreset()
const _init = _stored ?? _defPreset

function persist(get: () => BtStore): void {
  const s = get()
  saveStoredPreset({
    tickerStart: s.tickerStart,
    tickerEnd: s.tickerEnd,
    priceColumn: s.priceColumn,
    extraSourceIds: s.extraSourceIds,
    indicatorSourceIds: s.indicatorSourceIds,
    backtestConfig: s.backtestConfig,
    selectedId: s.selectedId,
    showIndicators: s.showIndicators,
  })
}

export const useBtStore = create<BtStore>((set, get) => ({
  tree: null,
  selectedId: _init.selectedId,
  runs: [],
  selectedRunId: null,
  showIndicators: _init.showIndicators,
  tickerStart: _init.tickerStart,
  tickerEnd: _init.tickerEnd,
  priceColumn: _init.priceColumn,
  extraSourceIds: _init.extraSourceIds,
  indicatorSourceIds: _init.indicatorSourceIds,
  backtestConfig: _init.backtestConfig,
  setTree: (tree) => {
    const raw = (tree as unknown as Record<string, unknown>).preset as Record<string, unknown> | null | undefined
    if (raw && typeof raw === 'object') {
      const tickerStart = (raw.ticker_start as string | null) ?? _init.tickerStart
      const tickerEnd = (raw.ticker_end as string | null) ?? _init.tickerEnd
      const priceColumn = (raw.price_column as 'close' | 'adj_close') ?? _init.priceColumn
      const extraSourceIds = (raw.extra_source_ids as Record<string, number>) ?? {}
      const indicatorSourceIds = (raw.indicator_source_ids as number[]) ?? []
      const cfg = (raw.config as Record<string, unknown>) ?? {}
      const commission = (cfg.commission as Record<string, unknown>) ?? {}
      const backtestConfig: BuilderBacktestConfig = {
        initial_capital: (cfg.initial_capital as number) ?? get().backtestConfig.initial_capital,
        integer_positions: (cfg.integer_positions as boolean) ?? get().backtestConfig.integer_positions,
        simple_fn: (commission.simple_fn as string) ?? get().backtestConfig.simple_fn ?? '',
        start: (cfg.start as string | null) ?? tickerStart,
        end: (cfg.end as string | null) ?? tickerEnd,
        price_column: (cfg.price_column as 'close' | 'adj_close') ?? priceColumn,
      }
      const selectedId = (raw.selected_node_id as string | null) ?? null
      const next: Partial<BtStore> = {
        tree,
        tickerStart,
        tickerEnd,
        priceColumn,
        extraSourceIds,
        indicatorSourceIds,
        backtestConfig,
      }
      if (selectedId && findNode(tree.root, selectedId)) next.selectedId = selectedId
      else if (selectedId == null && get().selectedId && findNode(tree.root, get().selectedId!)) {
        // keep existing
      } else {
        next.selectedId = tree.root.id ?? null
      }
      set(next)
      persist(get)
    } else {
      const curSel = get().selectedId
      const sel = curSel && findNode(tree.root, curSel) ? curSel : (tree.root.id ?? null)
      set({ tree, selectedId: sel })
    }
  },
  setSelected: (selectedId) => {
    set({ selectedId })
    persist(get)
  },
  setRuns: (runs) => set({ runs }),
  setSelectedRun: (selectedRunId) => set({ selectedRunId }),
  toggleIndicators: () => {
    const next = !get().showIndicators
    set({ showIndicators: next })
    persist(get)
  },
  setTickerStart: (tickerStart) => {
    set({ tickerStart })
    persist(get)
  },
  setTickerEnd: (tickerEnd) => {
    set({ tickerEnd })
    persist(get)
  },
  setPriceColumn: (priceColumn) => {
    set({ priceColumn })
    persist(get)
  },
  setExtraSourceIds: (extraSourceIds) => {
    set({ extraSourceIds })
    persist(get)
  },
  setIndicatorSourceIds: (indicatorSourceIds) => {
    set({ indicatorSourceIds })
    persist(get)
  },
  setBacktestConfig: (patch) => {
    const next = { ...get().backtestConfig, ...patch }
    set({ backtestConfig: next })
    persist(get)
  },
  updateNode: (id, patch) => {
    const { tree } = get()
    if (!tree) return
    const root = updateNodeRec(tree.root, id, patch)
    if (patch.name != null && id === tree.root.id) set({ tree: { ...tree, name: patch.name, root } })
    else set({ tree: { ...tree, root } })
  },
  addChild: (parentId, node) => {
    const { tree } = get()
    if (!tree) return
    const child: NodeConfig = { id: node.id || uid(), ...node }
    const root = addChildRec(tree.root, parentId, child)
    set({ tree: { ...tree, root } })
  },
  removeNode: (id) => {
    const { tree, selectedId } = get()
    if (!tree) return
    if (tree.root.id === id) return
    const root = removeRec(tree.root, id)
    set({ tree: { ...tree, root }, selectedId: selectedId === id ? null : selectedId })
  },
  moveNode: (id, newParentId, index) => {
    const { tree } = get()
    if (!tree) return
    if (tree.root.id === id) return
    const moving = findNode(tree.root, id)
    if (!moving) return
    const without = removeRec(tree.root, id)
    if (findNode(moving, newParentId)) return
    const root = insertAtRec(without, newParentId, moving, index)
    set({ tree: { ...tree, root } })
  },
}))

// re-exports for backward compatibility — callers can still import from btStore
export { createDefaultTree, findNode, findParent } from './treeOps'
export { buildPresetForTree, applyPresetToTree } from './preset'
export type { StoredPreset, BuilderBacktestConfig } from './preset'
export { BUILDER_PRESET_KEY } from './preset'
