import { useEffect, useMemo, useState } from 'react'
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { algosApi, dataApi, type AlgoMeta, type AlgoSchema, type DataSourceRow } from '../../api/bt'
import Tooltip from './Tooltip'
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
  label: { fontSize: 12, color: '#8b949e', cursor: 'help' },
  handle: { cursor: 'grab', padding: '0 4px', color: '#8b949e', userSelect: 'none' as const },
  algoName: { fontSize: 13, cursor: 'help' },
  expandBtn: { fontSize: 11, color: '#58a6ff', cursor: 'pointer', background: 'none', border: 'none', padding: 0, lineHeight: 1 },
}

function AlgoItem({
  algo,
  idx,
  onRemove,
  onUpdate,
  indicatorSources,
  signalSources,
  meta,
}: {
  algo: AlgoConfig
  idx: number
  onRemove: () => void
  onUpdate: (patch: Record<string, unknown>) => void
  indicatorSources: DataSourceRow[]
  signalSources: DataSourceRow[]
  meta: AlgoMeta | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: `${algo.class_name}-${idx}` })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const [schema, setSchema] = useState<AlgoSchema | null>(null)
  const [expanded, setExpanded] = useState(false)
  const isSelectWhere = algo.class_name === 'SelectWhere'

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

  const docTooltip = meta?.doc ?? ''
  const docLines = docTooltip.split('\n').filter(Boolean)
  const firstLine = docLines[0] ?? ''
  const extraLines = docLines.slice(1).join('\n')

  return (
    <div ref={setNodeRef} style={{ ...S.item, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={S.handle} {...attributes} {...listeners}>
          ⋮⋮
        </span>
        <Tooltip
          trigger={<strong style={S.algoName}>{algo.class_name}</strong>}
          fullWidth
          content={firstLine ? (
            <span>
              {firstLine}
              {extraLines && (
                <>
                  {expanded ? <br /> : '…'}
                  {expanded ? extraLines : null}
                </>
              )}
              {extraLines && (
                <button style={S.expandBtn} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
                  {expanded ? '[chiudi]' : '[espandi]'}
                </button>
              )}
            </span>
          ) : ''}
        />
        <button onClick={onRemove} type="button" style={{ background: 'transparent', border: 'none', color: '#f85149', cursor: 'pointer' }}>
          ×
        </button>
      </div>
      {schema && Object.keys(schema.properties).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(schema.properties).map(([k, pmeta]) => {
            const val = (algo.params as Record<string, unknown>)[k]
            const t = pmeta.type
            const paramDesc = meta?.param_docs?.[k]
            const labelEl = (
              <Tooltip
                trigger={<span style={S.label}>{k}</span>}
                content={paramDesc ?? ''}
              />
            )
            // indicator ref → render select with available indicators
            if ((pmeta as Record<string, unknown>).kind === 'indicator') {
              // ponytail: SelectWhere.signal è un indicatore puro, nessuna condizione
               if (isSelectWhere) {
                 return (
                   <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                     {labelEl}
                     <select
                       value={val as string ?? ''}
                       onChange={(e) => onUpdate({ [k]: e.target.value || undefined })}
                       style={S.sel}
                     >
                       <option value="">None</option>
                       {signalSources.map((sig) => (
                         <option key={sig.id} value={String(sig.id)}>
                           #[sig-{sig.id}] {sig.name}
                         </option>
                       ))}
                     </select>
                   </div>
                 )
               }
              const cond = (algo as Record<string, unknown>).signal_condition as Record<string, unknown> | null | undefined
              const condOp = (cond as Record<string, unknown>)?.op as string | undefined
              return (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {labelEl}
                  <div style={S.row}>
                    <select
                      value={val as string ?? ''}
                      onChange={(e) => onUpdate({ [k]: e.target.value || undefined })}
                      style={{ ...S.sel, flex: 1 }}
                    >
                      <option value="">None</option>
                      {indicatorSources.map((ind) => (
                        <option key={ind.id} value={String(ind.id)}>
                          #{ind.id} {ind.name} ({String((ind.meta as Record<string, unknown>)?.indicator_type ?? '?')})
                        </option>
                      ))}
                      {signalSources.map((sig) => (
                        <option key={sig.id} value={String(sig.id)}>
                          #[sig-{sig.id}] {sig.name}
                        </option>
                      ))}
                    </select>
                    {(() => {
                      const selectedId = val as string
                      const isSignal = Boolean(selectedId && signalSources.some((s) => String(s.id) === selectedId))
                      return (
                        <select
                          value={condOp ?? ''}
                          onChange={(e) => {
                            const op = e.target.value
                            const nextCond = op ? { op } : null
                            ;(algo as Record<string, unknown>).signal_condition = nextCond
                            onUpdate({ [k]: val })
                            onUpdate({ __signal_condition__: nextCond ?? undefined })
                          }}
                          style={{ ...S.sel, flex: 0, minWidth: 140 }}
                          disabled={isSignal}
                          title={isSignal ? 'pre-selezionato — già booleano' : 'Signal condition'}
                        >
                          <option value="">— nessuna —</option>
                          <option value="above">price {'>'} indicator</option>
                          <option value="below">price {'<'} indicator</option>
                          <option value="gt">indicator {'>'} 0</option>
                          <option value="lt">indicator {'<'} 0</option>
                          <option value="cross_over">crossover</option>
                          <option value="cross_down">crossunder</option>
                        </select>
                      )
                    })()}
                  </div>
                </div>
              )
            }
            // enum via string with options? BE currently always string
            if (t === 'boolean' || t === 'bool') {
              return (
                <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) => onUpdate({ [k]: e.target.checked })}
                  />
                  {labelEl}
                </label>
              )
            }
            if (t === 'integer' || t === 'number' || t === 'float') {
              return (
                <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {labelEl}
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
                {labelEl}
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
  const [indicatorSources, setIndicatorSources] = useState<DataSourceRow[]>([])
  const [signalSources, setSignalSources] = useState<DataSourceRow[]>([])

  useEffect(() => {
    algosApi
      .list()
      .then((l) => {
        setMetas(l)
        if (l.length > 0 && !l.find((x) => x.name === sel)) setSel(l[0].name)
      })
      .catch((e) => {
        console.error('[AlgoStack] Failed to load algos:', e)
      })
    const refresh = () => {
      Promise.all([dataApi.listIndicators(), dataApi.listSignals()]).then(([inds, sigs]) => {
        setIndicatorSources(inds)
        setSignalSources(sigs)
      }).catch(() => { /* ignore */ })
    }
    dataApi
      .listIndicators()
      .then(setIndicatorSources)
      .catch(() => { /* ignore */ })
    dataApi
      .listSignals()
      .then(setSignalSources)
      .catch(() => { /* ignore */ })
    window.addEventListener('bt-indicator-refresh', refresh)
    return () => window.removeEventListener('bt-indicator-refresh', refresh)
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
    const next = algos.map((a, j) => {
      if (j !== i) return a
      const base = { ...a, params: { ...a.params, ...patch } }
      // handle signal_condition as top-level field
      const sc = patch['__signal_condition__']
      if (sc !== undefined) return { ...base, signal_condition: sc ?? null }
      return base
    })
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
                <AlgoItem key={`${a.class_name}-${i}`} algo={a} idx={i} onRemove={() => removeAt(i)} onUpdate={(p) => updateAt(i, p)} indicatorSources={indicatorSources} signalSources={signalSources} meta={metas.find((m) => m.name === a.class_name) ?? null} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
