import { useEffect, useState } from 'react'
import { DndContext, closestCenter, type DragEndEvent, type DragStartEvent, useDraggable, DragOverlay } from '@dnd-kit/core'
import { useBtStore, createDefaultTree, findNode, findParent } from '../store/btStore'
import { strategiesApi } from '../../api/bt'
import TreeEditor from './TreeEditor'
import NodeInspector from './NodeInspector'
import type { NodeConfig } from '../../types/bt'

const NODE_TYPES = ['Strategy', 'Security', 'FixedIncomeStrategy', 'HedgeSecurity', 'CouponPayingSecurity'] as const
type NodeType = (typeof NODE_TYPES)[number]

const S = {
  top: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' as const },
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', minWidth: 180 },
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  layout: { display: 'flex', gap: 12, height: 'calc(100vh - 100px)', alignItems: 'stretch' },
  palette: { width: 180, minWidth: 180, border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  card: { border: '1px solid #30363d', borderRadius: 6, background: '#161b22', padding: '8px 10px', cursor: 'grab', fontSize: 13, color: '#c9d1d9' },
  msg: { fontSize: 12, color: '#8b949e' },
}

function PaletteCard({ type }: { type: NodeType }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { type, isPalette: true } as unknown as Record<string, unknown>,
  })
  const style = {
    ...S.card,
    opacity: isDragging ? 0.5 : 1,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  }
  const icon: Record<string, string> = {
    Strategy: '◈',
    Security: '◎',
    FixedIncomeStrategy: '⬢',
    HedgeSecurity: '⬣',
    CouponPayingSecurity: '⬔',
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {icon[type] ?? '•'} {type}
    </div>
  )
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10)
}

export default function BuilderView() {
  const tree = useBtStore((s) => s.tree)
  const setTree = useBtStore((s) => s.setTree)
  const addChild = useBtStore((s) => s.addChild)
  const moveNode = useBtStore((s) => s.moveNode)
  const [nameDraft, setNameDraft] = useState('')
  const [savedId, setSavedId] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [activeType, setActiveType] = useState<string | null>(null)
  const [rows, setRows] = useState<{ id: number; name: string }[]>([])
  const [loadId, setLoadId] = useState('')

  useEffect(() => {
    if (!tree) {
      const def = createDefaultTree()
      setTree(def)
      setNameDraft(def.name)
      setSavedId(null)
    } else if (!nameDraft) {
      setNameDraft(tree.name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (tree) setNameDraft(tree.name)
  }, [tree?.name])

  const refreshList = () => {
    strategiesApi
      .list()
      .then((l) => setRows(l.map((r) => ({ id: r.id, name: r.name }))))
      .catch(() => {
        /* ignore */
      })
  }

  useEffect(() => {
    refreshList()
  }, [])

  const handleSave = async () => {
    if (!tree) return
    const toSave = { ...tree, name: nameDraft.trim() || tree.name }
    try {
      if (savedId != null) {
        const r = await strategiesApi.update(savedId, toSave)
        setTree(r.tree as unknown as typeof tree)
        setMsg(`updated #${savedId}`)
      } else {
        const r = await strategiesApi.create(toSave)
        setSavedId(r.id)
        setTree(r.tree as unknown as typeof tree)
        setMsg(`saved #${r.id}`)
      }
      refreshList()
    } catch (e) {
      setMsg(String(e))
    }
  }

  const handleLoad = async () => {
    const sid = Number(loadId)
    if (!sid) return
    try {
      const r = await strategiesApi.get(sid)
      const t = r.tree as unknown as typeof tree
      // ensure version/name align
      setTree(t!)
      setNameDraft(t!.name)
      setSavedId(sid)
      setMsg(`loaded #${sid}`)
    } catch (e) {
      setMsg(String(e))
    }
  }

  const handleNew = () => {
    const def = createDefaultTree()
    setTree(def)
    setNameDraft(def.name)
    setSavedId(null)
    setMsg('new tree')
  }

  const treeNameCommit = () => {
    if (!tree) return
    const v = nameDraft.trim()
    if (!v || v === tree.name) return
    setTree({ ...tree, name: v })
  }

  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as Record<string, unknown> | undefined
    if (d && d['isPalette']) setActiveType(String(d['type']))
    else setActiveType(null)
  }

  const onDragEnd = (e: DragEndEvent) => {
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
      // determine parent
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
      // only Strategy can have children — if parent is Security, fall back to its parent or root
      const parentNode = findNode(tree.root, parentId)
      const canHaveChildren = parentNode?.type === 'Strategy' || parentNode?.type === 'FixedIncomeStrategy'
      if (!canHaveChildren) {
        const p = parentNode && parentId ? findParent(tree.root, parentId) : null
        parentId = p && p.id ? p.id! : tree.root.id!
      }
      addChild(parentId!, newNode)
      return
    }

    // reorder existing node
    const activeId = String(active.id)
    const overId = over ? String(over.id) : null
    if (!overId || activeId === overId) return
    if (tree.root.id === activeId) return

    const activeNode = findNode(tree.root, activeId)
    const overNode = findNode(tree.root, overId)
    if (!activeNode || !overNode) return

    const activeParent = findParent(tree.root, activeId)
    const overParent = findParent(tree.root, overId)

    // If dragging onto a Strategy container (empty drop), move as child append
    // Heuristic: if overNode is Strategy and overId !== activeParent?.id and activeParent?.id !== overId, treat as append child
    // But sortable over is always a sibling item; dropping onto empty area is handled by palette case.
    // For now handle reorder within same parent, and cross-parent as append/move-as-sibling.
    if (activeParent && overParent && activeParent.id === overParent.id && activeParent.id) {
      const siblings = activeParent.children
      const oldIdx = siblings.findIndex((c) => c.id === activeId)
      const newIdx = siblings.findIndex((c) => c.id === overId)
      if (oldIdx === -1 || newIdx === -1) return
      moveNode(activeId, activeParent.id!, newIdx)
    } else if (overNode.type === 'Strategy' || overNode.type === 'FixedIncomeStrategy') {
      // drop onto strategy as child append
      const idx = overNode.children.length
      moveNode(activeId, overNode.id!, idx)
    } else if (overParent && overParent.id) {
      const newIdx = overParent.children.findIndex((c) => c.id === overId)
      moveNode(activeId, overParent.id!, newIdx === -1 ? overParent.children.length : newIdx)
    }
  }

  if (!tree) return <div>loading…</div>

  return (
    <div>
      <div style={S.top}>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={treeNameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') treeNameCommit()
          }}
          style={S.input}
          placeholder="strategy name"
        />
        <button onClick={handleSave} type="button" style={S.btnPri}>
          Save
        </button>
        <button onClick={handleNew} type="button" style={S.btn}>
          New
        </button>
        <select value={loadId} onChange={(e) => setLoadId(e.target.value)} style={S.input as unknown as Record<string, string>}>
          <option value="">— load —</option>
          {rows.map((r) => (
            <option key={r.id} value={String(r.id)}>
              #{r.id} {r.name}
            </option>
          ))}
        </select>
        <button onClick={handleLoad} type="button" style={S.btn}>
          Load
        </button>
        {msg && <span style={S.msg}>{msg}</span>}
      </div>

      <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div style={S.layout}>
          <div style={S.palette}>
            <div style={{ fontSize: 12, color: '#8b949e', fontWeight: 700 }}>Palette</div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>drag onto canvas</div>
            {NODE_TYPES.map((t) => (
              <PaletteCard key={t} type={t} />
            ))}
          </div>

          <TreeEditor />

          <NodeInspector />
        </div>
        <DragOverlay>{activeType ? <div style={{ ...S.card, opacity: 0.9 }}>{activeType}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
