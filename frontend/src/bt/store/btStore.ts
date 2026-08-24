import { create } from 'zustand'
import type { StrategyTree, NodeConfig } from '../../types/bt'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10)
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
  }
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
  setTree: (t: StrategyTree) => void
  setSelected: (id: string | null) => void
  setRuns: (r: RunMeta[]) => void
  setSelectedRun: (id: number | null) => void
  toggleIndicators: () => void
  updateNode: (id: string, patch: Partial<NodeConfig>) => void
  addChild: (parentId: string, node: NodeConfig) => void
  removeNode: (id: string) => void
  moveNode: (id: string, newParentId: string, index: number) => void
}

export const useBtStore = create<BtStore>((set, get) => ({
  tree: null,
  selectedId: null,
  runs: [],
  selectedRunId: null,
  showIndicators: false,
  setTree: (tree) => set({ tree }),
  setSelected: (selectedId) => set({ selectedId }),
  setRuns: (runs) => set({ runs }),
  setSelectedRun: (selectedRunId) => set({ selectedRunId }),
  toggleIndicators: () => set((s) => ({ showIndicators: !s.showIndicators })),
  updateNode: (id, patch) => {
    const { tree } = get()
    if (!tree) return
    const root = updateNodeRec(tree.root, id, patch)
    set({ tree: { ...tree, root } })
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
