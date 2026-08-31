import { useState } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { NodeConfig } from '../types/bt'
import { useBtStore } from '../bt/store/btStore'
import { findNode, findParent } from '../bt/store/treeOps'

type NodeType = 'Strategy' | 'Security' | 'FixedIncomeStrategy' | 'HedgeSecurity' | 'CouponPayingSecurity'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
}

export function useTreeDrag() {
  const [activeType, setActiveType] = useState<string | null>(null)
  const tree = useBtStore((s) => s.tree)
  const addChild = useBtStore((s) => s.addChild)
  const moveNode = useBtStore((s) => s.moveNode)

  const onDragStart = (e: DragStartEvent): void => {
    const d = e.active.data.current as Record<string, unknown> | undefined
    if (d && d['isPalette']) setActiveType(String(d['type']))
    else setActiveType(null)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setActiveType(null)
    const { active, over } = e
    if (!tree) return
    const ad = active.data.current as Record<string, unknown> | undefined
    const isPalette = Boolean(ad && ad['isPalette'])

    if (isPalette) {
      const type = String(ad?.['type']) as NodeType
      const newNode: NodeConfig = {
        id: uid(),
        name: type === 'Security' ? 'NEW_TICKER' : `New${type}`,
        type,
        params: {},
        algos: [],
        children: [],
      }
      let parentId = tree.root.id!
      if (over) {
        const overId = String(over.id)
        const overNode = findNode(tree.root, overId)
        if (overNode) {
          const isStrat = overNode.type === 'Strategy' || overNode.type === 'FixedIncomeStrategy'
          if (isStrat) parentId = overNode.id!
          else {
            const p = findParent(tree.root, overId)
            if (p && p.id) parentId = p.id!
          }
        }
      }
      const parentNode = findNode(tree.root, parentId)
      const canHaveChildren = parentNode?.type === 'Strategy' || parentNode?.type === 'FixedIncomeStrategy'
      if (!canHaveChildren) {
        const p = parentNode && parentId ? findParent(tree.root, parentId) : null
        parentId = p && p.id ? p.id! : tree.root.id!
      }
      addChild(parentId!, newNode)
      return
    }

    const activeId = String(active.id)
    const overId = over ? String(over.id) : null
    if (!overId || activeId === overId) return
    if (tree.root.id === activeId) return

    const activeNode = findNode(tree.root, activeId)
    const overNode = findNode(tree.root, overId)
    if (!activeNode || !overNode) return

    const activeParent = findParent(tree.root, activeId)
    const overParent = findParent(tree.root, overId)

    if (activeParent && overParent && activeParent.id === overParent.id && activeParent.id) {
      const siblings = activeParent.children
      const oldIdx = siblings.findIndex((c) => c.id === activeId)
      const newIdx = siblings.findIndex((c) => c.id === overId)
      if (oldIdx === -1 || newIdx === -1) return
      moveNode(activeId, activeParent.id!, newIdx)
    } else if (overNode.type === 'Strategy' || overNode.type === 'FixedIncomeStrategy') {
      const idx = overNode.children.length
      moveNode(activeId, overNode.id!, idx)
    } else if (overParent && overParent.id) {
      const newIdx = overParent.children.findIndex((c) => c.id === overId)
      moveNode(activeId, overParent.id!, newIdx === -1 ? overParent.children.length : newIdx)
    }
  }

  return { activeType, onDragStart, onDragEnd }
}
