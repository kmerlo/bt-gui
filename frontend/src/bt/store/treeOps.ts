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
    preset: null as unknown as undefined,
  } as unknown as StrategyTree
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

export function updateNodeRec(node: NodeConfig, id: string, patch: Partial<NodeConfig>): NodeConfig {
  if (node.id === id) return { ...node, ...patch }
  return { ...node, children: node.children.map((c) => updateNodeRec(c, id, patch)) }
}

export function addChildRec(node: NodeConfig, parentId: string, child: NodeConfig): NodeConfig {
  if (node.id === parentId) return { ...node, children: [...node.children, child] }
  return { ...node, children: node.children.map((c) => addChildRec(c, parentId, child)) }
}

export function removeRec(node: NodeConfig, id: string): NodeConfig {
  return { ...node, children: node.children.filter((c) => c.id !== id).map((c) => removeRec(c, id)) }
}

export function insertAtRec(
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

export function cloneWithNewIds(node: NodeConfig): NodeConfig {
  return {
    ...node,
    id: uid(),
    params: { ...(node.params as Record<string, unknown>) },
    algos: node.algos.map((a) => ({
      ...a,
      params: { ...(a.params as Record<string, unknown>) },
      signal_condition: a.signal_condition ? { ...(a.signal_condition as Record<string, unknown>) } : a.signal_condition,
    })),
    children: node.children.map(cloneWithNewIds),
  }
}
