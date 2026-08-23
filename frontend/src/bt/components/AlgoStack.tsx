import { useEffect, useMemo, useState } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { algosApi, type AlgoMeta, type AlgoSchema } from '../../api/bt'
import { useBtStore, findNode } from '../store/btStore'
import type { AlgoConfig } from '../../types/bt'

const S = {
  wrap: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  sel: { flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' },
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  item: { border: '1px solid #30363d', borderRadius: 8, background: '#161b22', padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  warn: { background: '#332a00', border: '1px solid #d29922', color: '#f0c040', borderRadius: 6, padding: '6px 8px', fontSize: 12 },
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 6px', width: '100%' },
  label: { fontSize: 12, color: '#8b949e' },
  handle: { cursor: 'grab', padding: '0 4px', color: '#8b949e', userSelect: 'none' as const },
}

function AlgoItem({
  algo,
  idx,
  onRemove,
  onUpdate,
}: {
  algo: AlgoConfig
  idx: number
  onRemove: () => void
  onUpdate: (patch: Record<string, unknown>) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `${algo.class_name}-${idx}` })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const [schema, setSchema] = useState<AlgoSchema | null>(null)

  useEffect(() => {
    let alive = true
    algosApi
      .schema(algo.class_name)
      .then((s) => {
        if (alive) setSchema(s)
      })
      .catch(() => {
        /* schema might not exist yet */
      })
    return () => {
      alive = false
    }
  }, [algo.class_name])

  return (
    <div ref={setNodeRef} style={{ ...S.item, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={S.handle} {...attributes} {...listeners}>
          ⋮⋮
        </span>
        <strong style={{ flex: 1, fontSize: 13 }}>{algo.class_name}</strong>
        <button onClick={onRemove} type="button" style={{ background: 'transparent', border: 'none', color: '#f85149', cursor: 'pointer' }}>
          ×
        </button>
      </div>
      {schema && Object.keys(schema.properties).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(schema.properties).map(([k, meta]) => {
            const val = (algo.params as Record<string, unknown>)[k]
            const t = meta.type
            // enum via string with options? BE currently always string
            if (t === 'boolean' || t === 'bool') {
              return (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onUpdate({ [k]: e.target.checked })}
                  />
                  <span style={S.label}>{k}</span>
                </label>
              )
            }
            if (t === 'integer' || t === 'number' || t === 'float') {
              return (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={S.label}>{k}</span>
                  <input
                    type="number"
                    value={val as string | number | undefined ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      onUpdate({ [k]: v === '' ? undefined : Number(v) })
                    }}
                    style={S.input}
                  />
                </label>
              )
            }
            return (
              <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={S.label}>{k}</span>
                <input
                  type="text"
                  value={(val as string) ?? ''}
                  onChange={(e) => onUpdate({ [k]: e.target.value })}
                  style={S.input}
                />
              </label>
            )
          })}
        </div>
      ) : (
        <span style={S.label}>no params</span>
      )}
    </div>
  )
}

export default function AlgoStack({ nodeId }: { nodeId: string }) {
  const tree = useBtStore((s) => s.tree)
  const updateNode = useBtStore((s) => s.updateNode)
  const node = tree ? findNode(tree.root, nodeId) : null
  const algos: AlgoConfig[] = (node?.algos as AlgoConfig[]) ?? []

  const [metas, setMetas] = useState<AlgoMeta[]>([])
  const [sel, setSel] = useState('RunMonthly')

  useEffect(() => {
    algosApi
      .list()
      .then((l) => {
        setMetas(l)
        if (l.length > 0 && !l.find((x) => x.name === sel)) setSel(l[0].name)
      })
      .catch(() => {
        /* ignore */
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const g: Record<string, AlgoMeta[]> = {}
    for (const m of metas) {
      const k = m.category || 'Other'
      if (!g[k]) g[k] = []
      g[k].push(m)
    }
    return g
  }, [metas])

  const add = () => {
    if (!node || !node.id) return
    const next: AlgoConfig[] = [...algos, { class_name: sel, params: {} }]
    updateNode(node.id!, { algos: next } as unknown as Partial<NonNullable<typeof node>>)
  }

  const removeAt = (i: number) => {
    if (!node || !node.id) return
    const next = algos.filter((_, j) => j !== i)
    updateNode(node.id!, { algos: next } as unknown as Partial<NonNullable<typeof node>>)
  }

  const updateAt = (i: number, patch: Record<string, unknown>) => {
    if (!node || !node.id) return
    const next = algos.map((a, j) => (j === i ? { ...a, params: { ...a.params, ...patch } } : a))
    updateNode(node.id!, { algos: next } as unknown as Partial<NonNullable<typeof node>>)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    if (!node || !node.id) return
    const ids = algos.map((a, i) => `${a.class_name}-${i}`)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(algos, oldIndex, newIndex)
    updateNode(node.id!, { algos: next } as unknown as Partial<NonNullable<typeof node>>)
  }

  // soft validation: Requires weights -> Sets weights before
  const warnings = useMemo(() => {
    const w: string[] = []
    const seenSets = new Set<string>()
    for (const a of algos) {
      const meta = metas.find((m) => m.name === a.class_name)
      const req = meta?.requires
      if (req) {
        const needs: string[] = req
          .toLowerCase()
          .split(/[,;]/)
          .map((s) => s.trim())
        for (const n of needs) {
          if (n.includes('weight') && ![...seenSets].some((s) => s.toLowerCase().includes('weight'))) {
            w.push(`${a.class_name} requires '${req}' — add Weigh* before it`)
            break
          }
        }
      }
      if (meta?.sets) seenSets.add(meta.sets)
    }
    return w
  }, [algos, metas])

  return (
    <div style={S.wrap}>
      <div style={S.row}>
        <select value={sel} onChange={(e) => setSel(e.target.value)} style={S.sel}>
          {Object.entries(grouped).map(([cat, list]) => (
            <optgroup key={cat} label={cat}>
              {list.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button onClick={add} type="button" style={S.btn}>
          Add
        </button>
      </div>

      {warnings.map((msg) => (
        <div key={msg} style={S.warn}>
          ⚠ {msg}
        </div>
      ))}

      {algos.length === 0 ? (
        <span style={S.label}>no algos — add one above</span>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={algos.map((a, i) => `${a.class_name}-${i}`)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {algos.map((a, i) => (
                <AlgoItem key={`${a.class_name}-${i}`} algo={a} idx={i} onRemove={() => removeAt(i)} onUpdate={(p) => updateAt(i, p)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
