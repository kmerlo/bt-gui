import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useBtStore } from '../store/btStore'
import type { NodeConfig } from '../../types/bt'

const S = {
  wrap: { flex: 1, border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, overflowY: 'auto' as const, minHeight: 300 },
  node: (selected: boolean) =>
    ({
      border: `1px solid ${selected ? '#58a6ff' : '#30363d'}`,
      borderRadius: 8,
      background: selected ? '#1f2b3a' : '#161b22',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 6,
      cursor: 'pointer',
    }) as const,
  head: { display: 'flex', alignItems: 'center', gap: 6 },
  badge: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' },
  handle: { cursor: 'grab', color: '#8b949e', padding: '0 4px', userSelect: 'none' as const },
  children: { marginLeft: 16, borderLeft: '1px dashed #21262d', paddingLeft: 10, display: 'flex', flexDirection: 'column' as const, gap: 8, marginTop: 8 },
  emptyDrop: { border: '1px dashed #30363d', borderRadius: 6, padding: 12, color: '#8b949e', fontSize: 12, textAlign: 'center' as const },
}

function NodeItem({ node, depth }: { node: NodeConfig; depth: number }) {
  const selectedId = useBtStore((s) => s.selectedId)
  const setSelected = useBtStore((s) => s.setSelected)
  const selected = selectedId === node.id
  const isStrategy = node.type === 'Strategy' || node.type === 'FixedIncomeStrategy'
  const nid = node.id ?? ''

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: nid,
    data: { node, depth } as unknown as Record<string, unknown>,
  })

  // also droppable for palette drops onto this node
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: nid, data: { node } as unknown as Record<string, unknown> })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    outline: isOver ? '1px dashed #58a6ff' : undefined,
  }

  // combine refs
  const setRefs = (el: HTMLDivElement | null) => {
    setNodeRef(el)
    setDropRef(el)
  }

  return (
    <div ref={setRefs} style={{ ...S.node(selected), ...style }}>
      <div style={S.head} onClick={() => setSelected(nid)}>
        <span style={S.handle} {...attributes} {...listeners}>
          ⋮⋮
        </span>
        <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#c9d1d9' }}>{node.name}</span>
        <span style={S.badge}>{node.type}</span>
        {isStrategy && node.algos.length > 0 && <span style={S.badge}>{node.algos.length} algos</span>}
      </div>
      {isStrategy ? (
        node.children.length > 0 ? (
          <div style={S.children}>
            <SortableContext items={node.children.map((c) => c.id ?? '').filter(Boolean)} strategy={verticalListSortingStrategy}>
              {node.children.map((c) => (
                <NodeItem key={c.id} node={c} depth={depth + 1} />
              ))}
            </SortableContext>
          </div>
        ) : (
          <div style={S.emptyDrop}>drop Securities / Strategies here</div>
        )
      ) : null}
    </div>
  )
}

export default function TreeEditor() {
  const tree = useBtStore((s) => s.tree)

  if (!tree) return <div style={S.wrap}>No tree</div>
  const rootId = tree.root.id ?? ''
  if (!rootId) return <div style={S.wrap}>No tree</div>

  return (
    <div style={S.wrap}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>Canvas — drag to reorder, click to inspect</div>
      <SortableContext items={[rootId]} strategy={verticalListSortingStrategy}>
        <NodeItem node={tree.root} depth={0} />
      </SortableContext>
    </div>
  )
}
