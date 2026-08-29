import { create } from 'zustand'
import type { StrategyTree, NodeConfig } from '../../types/bt'
import { loadSettings } from '../../api/bt'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
}

export const BUILDER_PRESET_KEY = 'bt-builder-preset:v1'

export type BuilderBacktestConfig = {
  initial_capital: number
  integer_positions: boolean
  simple_fn: string
}

export type StoredPreset = {
  priceSourceId: number | null
  extraSourceIds: Record<string, number>
  indicatorSourceIds: number[]
  backtestConfig: BuilderBacktestConfig
  selectedId: string | null
  showIndicators: boolean
}

function loadStoredPreset(): StoredPreset | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BUILDER_PRESET_KEY) : null
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<StoredPreset>
    return {
      priceSourceId: (p.priceSourceId as number | null) ?? null,
      extraSourceIds: (p.extraSourceIds as Record<string, number>) ?? {},
      indicatorSourceIds: (p.indicatorSourceIds as number[]) ?? [],
      backtestConfig: p.backtestConfig ?? {
        initial_capital: loadSettings().initial_capital,
        integer_positions: loadSettings().integer_positions,
        simple_fn: loadSettings().simple_fn,
      },
      selectedId: (p.selectedId as string | null) ?? null,
      showIndicators: Boolean(p.showIndicators),
    }
  } catch {
    return null
  }
}

function saveStoredPreset(p: StoredPreset): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(BUILDER_PRESET_KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

function defaultPreset(): StoredPreset {
  const s = loadSettings()
  return {
    priceSourceId: null,
    extraSourceIds: {},
    indicatorSourceIds: [],
    backtestConfig: { initial_capital: s.initial_capital, integer_positions: s.integer_positions, simple_fn: s.simple_fn },
    selectedId: null,
    showIndicators: false,
  }
}

export function createDefaultTree(): StrategyTree {
  return {
    name: 'MyStrategy',
    version: 1,
    root: {
      id: uid(),
      name: 'MyStrategy',
      type: 'Strategy',
      params: {},
      algos: [],
      children: [
        { id: uid(), name: 'AAPL', type: 'Security', params: {}, algos: [], children: [] },
      ],
    },
    preset: null as unknown as undefined,
  } as unknown as StrategyTree
}

// build preset object to embed into tree_json for per-strategy persistence
export function buildPresetForTree(get: () => BtStore): Record<string, unknown> {
  const s = get()
  // always save config + selected to make reload complete, even if no data source yet
  return {
    price_source_id: s.priceSourceId,
    extra_source_ids: s.extraSourceIds,
    indicator_source_ids: s.indicatorSourceIds,
    config: {
      initial_capital: s.backtestConfig.initial_capital,
      integer_positions: s.backtestConfig.integer_positions,
      commission: { type: 'simple', simple_fn: s.backtestConfig.simple_fn || null },
    },
    selected_node_id: s.selectedId,
  }
}

export function applyPresetToTree(tree: StrategyTree, preset: Record<string, unknown> | null | undefined): StrategyTree {
  if (!preset) return tree
  return { ...tree, preset } as unknown as StrategyTree
}

export function findNode(root: NodeConfig, id: string): NodeConfig | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const f = findNode(c, id)
    if (f) return f
  }
  return null
}

export function findParent(root: NodeConfig, id: string): NodeConfig | null {
  for (const c of root.children) {
    if (c.id === id) return root
    const f = findParent(c, id)
    if (f) return f
  }
  return null
}

function updateNodeRec(node: NodeConfig, id: string, patch: Partial<NodeConfig>): NodeConfig {
  if (node.id === id) return { ...node, ...patch }
  return { ...node, children: node.children.map((c) => updateNodeRec(c, id, patch)) }
}

function addChildRec(node: NodeConfig, parentId: string, child: NodeConfig): NodeConfig {
  if (node.id === parentId) return { ...node, children: [...node.children, child] }
  return { ...node, children: node.children.map((c) => addChildRec(c, parentId, child)) }
}

function removeRec(node: NodeConfig, id: string): NodeConfig {
  return { ...node, children: node.children.filter((c) => c.id !== id).map((c) => removeRec(c, id)) }
}

function insertAtRec(
  node: NodeConfig,
  parentId: string,
  child: NodeConfig,
  index: number,
): NodeConfig {
  if (node.id === parentId) {
    const next = [...node.children]
    const idx = Math.max(0, Math.min(index, next.length))
    next.splice(idx, 0, child)
    return { ...node, children: next }
  }
  return { ...node, children: node.children.map((c) => insertAtRec(c, parentId, child, index)) }
}

type RunMeta = { id: number; strategy_id: number | null; stats: Record<string, unknown> | null }

type BtStore = {
  tree: StrategyTree | null
  selectedId: string | null
  runs: RunMeta[]
  selectedRunId: number | null
  showIndicators: boolean
  priceSourceId: number | null
  extraSourceIds: Record<string, number>
  indicatorSourceIds: number[]
  backtestConfig: BuilderBacktestConfig
  setTree: (t: StrategyTree) => void
  setSelected: (id: string | null) => void
  setRuns: (r: RunMeta[]) => void
  setSelectedRun: (id: number | null) => void
  toggleIndicators: () => void
  setPriceSourceId: (id: number | null) => void
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

export const useBtStore = create<BtStore>((set, get) => ({
  tree: null,
  selectedId: _init.selectedId,
  runs: [],
  selectedRunId: null,
  showIndicators: _init.showIndicators,
  priceSourceId: _init.priceSourceId,
  extraSourceIds: _init.extraSourceIds,
  indicatorSourceIds: _init.indicatorSourceIds,
  backtestConfig: _init.backtestConfig,
  setTree: (tree) => {
    // restore preset from tree if present (per-strategy DB), otherwise keep fallback
    const raw = (tree as unknown as Record<string, unknown>).preset as Record<string, unknown> | null | undefined
    if (raw && typeof raw === 'object') {
      const priceSourceId = (raw.price_source_id as number | null) ?? null
      const extraSourceIds = (raw.extra_source_ids as Record<string, number>) ?? {}
      const indicatorSourceIds = (raw.indicator_source_ids as number[]) ?? []
      const cfg = (raw.config as Record<string, unknown>) ?? {}
      const commission = (cfg.commission as Record<string, unknown>) ?? {}
      const backtestConfig: BuilderBacktestConfig = {
        initial_capital: (cfg.initial_capital as number) ?? get().backtestConfig.initial_capital,
        integer_positions: (cfg.integer_positions as boolean) ?? get().backtestConfig.integer_positions,
        simple_fn: (commission.simple_fn as string) ?? get().backtestConfig.simple_fn ?? '',
      }
      const selectedId = (raw.selected_node_id as string | null) ?? null
      const next: Partial<BtStore> = {
        tree,
        priceSourceId,
        extraSourceIds,
        indicatorSourceIds,
        backtestConfig,
      }
      // inspector: restore selection; fallback to root if preset points to missing node
      if (selectedId && findNode(tree.root, selectedId)) next.selectedId = selectedId
      else if (selectedId == null && get().selectedId && findNode(tree.root, get().selectedId!)) {
        // keep existing selection if preset has no selection but current selection still valid
      } else {
        // default to root so inspector not empty
        next.selectedId = tree.root.id ?? null
      }
      set(next)
      saveStoredPreset({
        priceSourceId: priceSourceId ?? null,
        extraSourceIds,
        indicatorSourceIds,
        backtestConfig,
        selectedId: next.selectedId ?? null,
        showIndicators: get().showIndicators,
      })
    } else {
      // legacy tree without preset: keep fallback but ensure inspector has selection
      const curSel = get().selectedId
      const sel = curSel && findNode(tree.root, curSel) ? curSel : (tree.root.id ?? null)
      set({ tree, selectedId: sel })
    }
  },
  setSelected: (selectedId) => {
    set({ selectedId })
    const s = get()
    saveStoredPreset({
      priceSourceId: s.priceSourceId,
      extraSourceIds: s.extraSourceIds,
      indicatorSourceIds: s.indicatorSourceIds,
      backtestConfig: s.backtestConfig,
      selectedId,
      showIndicators: s.showIndicators,
    })
  },
  setRuns: (runs) => set({ runs }),
  setSelectedRun: (selectedRunId) => set({ selectedRunId }),
  toggleIndicators: () => set((s) => {
    const next = !s.showIndicators
    saveStoredPreset({
      priceSourceId: s.priceSourceId,
      extraSourceIds: s.extraSourceIds,
      indicatorSourceIds: s.indicatorSourceIds,
      backtestConfig: s.backtestConfig,
      selectedId: s.selectedId,
      showIndicators: next,
    })
    return { showIndicators: next }
  }),
  setPriceSourceId: (priceSourceId) => {
    set({ priceSourceId })
    const s = get()
    saveStoredPreset({
      priceSourceId,
      extraSourceIds: s.extraSourceIds,
      indicatorSourceIds: s.indicatorSourceIds,
      backtestConfig: s.backtestConfig,
      selectedId: s.selectedId,
      showIndicators: s.showIndicators,
    })
  },
  setExtraSourceIds: (extraSourceIds) => {
    set({ extraSourceIds })
    const s = get()
    saveStoredPreset({
      priceSourceId: s.priceSourceId,
      extraSourceIds,
      indicatorSourceIds: s.indicatorSourceIds,
      backtestConfig: s.backtestConfig,
      selectedId: s.selectedId,
      showIndicators: s.showIndicators,
    })
  },
  setIndicatorSourceIds: (indicatorSourceIds) => {
    set({ indicatorSourceIds })
    const s = get()
    saveStoredPreset({
      priceSourceId: s.priceSourceId,
      extraSourceIds: s.extraSourceIds,
      indicatorSourceIds,
      backtestConfig: s.backtestConfig,
      selectedId: s.selectedId,
      showIndicators: s.showIndicators,
    })
  },
  setBacktestConfig: (patch) => {
    const next = { ...get().backtestConfig, ...patch }
    set({ backtestConfig: next })
    const s = get()
    saveStoredPreset({
      priceSourceId: s.priceSourceId,
      extraSourceIds: s.extraSourceIds,
      indicatorSourceIds: s.indicatorSourceIds,
      backtestConfig: next,
      selectedId: s.selectedId,
      showIndicators: s.showIndicators,
    })
  },
  updateNode: (id, patch) => {
    const { tree } = get()
    if (!tree) return
    const root = updateNodeRec(tree.root, id, patch)
    // ponytail: keep tree.name and root.name in sync (single source of truth)
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
    // prevent moving into own subtree
    if (findNode(moving, newParentId)) return
    const root = insertAtRec(without, newParentId, moving, index)
    set({ tree: { ...tree, root } })
  },
}))
