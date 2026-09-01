import { useEffect } from 'react'
import { DndContext, closestCenter, DragOverlay, useDraggable } from '@dnd-kit/core'
import { useBtStore, createDefaultTree } from '../store/btStore'
import { useTreeDrag } from '../../hooks/useTreeDrag'
import { useStrategySave } from '../../hooks/useStrategySave'
import TreeEditor from './TreeEditor'
import NodeInspector from './NodeInspector'
import IndicatorPanel from './IndicatorPanel'
import SignalPanel from './SignalPanel'
import RunDialog from './RunDialog'

const NODE_TYPES = ['Strategy', 'Security', 'FixedIncomeStrategy', 'HedgeSecurity', 'CouponPayingSecurity'] as const
type NodeType = (typeof NODE_TYPES)[number]

const S = {
  top: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' as const },
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', minWidth: 180 },
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  row: { display: 'flex', gap: 12, alignItems: 'stretch' },
  rowTop: { display: 'flex', gap: 12, alignItems: 'stretch' },
  palette: { width: 180, minWidth: 180, border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 10, display: 'flex', flexDirection: 'column' as const, gap: 8, flexShrink: 0 },
  card: { border: '1px solid #30363d', borderRadius: 6, background: '#161b22', padding: '8px 10px', cursor: 'grab', fontSize: 13, color: '#c9d1d9' },
  msg: { fontSize: 12, color: '#8b949e' },
  runDialogCol: { width: 340, minWidth: 340, flexShrink: 0 },
}

function PaletteCard({ type }: { type: NodeType }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { type, isPalette: true } as unknown as Record<string, unknown>,
  })
  const style = { ...S.card, opacity: isDragging ? 0.5 : 1, transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }
  const icon: Record<string, string> = { Strategy: '◈', Security: '◎', FixedIncomeStrategy: '⬢', HedgeSecurity: '⬣', CouponPayingSecurity: '⬔' }
  return <div ref={setNodeRef} style={style} {...attributes} {...listeners}>{icon[type] ?? '•'} {type}</div>
}

export default function BuilderView({ onRunCreated }: { onRunCreated?: (id: number) => void }) {
  const tree = useBtStore((s) => s.tree)
  const setTree = useBtStore((s) => s.setTree)
  const showIndicators = useBtStore((s) => s.showIndicators)
  const toggleIndicators = useBtStore((s) => s.toggleIndicators)
  const showSignals = useBtStore((s) => s.showSignals)
  const toggleSignals = useBtStore((s) => s.toggleSignals)
  const showPalette = useBtStore((s) => s.showPalette)
  const togglePalette = useBtStore((s) => s.togglePalette)
  const { activeType, onDragStart, onDragEnd } = useTreeDrag()
  const { nameDraft, setNameDraft, rows, loadId, setLoadId, msg, handleSave, handleSaveAsNew, handleLoad, handleNew, treeNameCommit } = useStrategySave()

  useEffect(() => {
    if (!tree) {
      const def = createDefaultTree()
      setTree(def)
      const sid = useBtStore.getState().selectedId
      if (!sid && def.root.id) useBtStore.getState().setSelected(def.root.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!tree) return <div>loading…</div>

  return (
    <div>
      <div style={S.top}>
        <button onClick={togglePalette} type="button" style={{ ...S.btn, minWidth: 36 }} title={showPalette ? 'Nascondi palette' : 'Mostra palette'}>☰</button>
        <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onBlur={treeNameCommit} onKeyDown={(e) => { if (e.key === 'Enter') treeNameCommit() }} style={S.input} placeholder="strategy name" />
        <button onClick={handleSave} type="button" style={S.btnPri}>Salva</button>
        <button onClick={handleSaveAsNew} type="button" style={S.btn}>Salva come nuova</button>
        <button onClick={handleNew} type="button" style={S.btn}>Nuova</button>
        <select value={loadId} onChange={(e) => setLoadId(e.target.value)} style={S.input as unknown as Record<string, string>}>
          <option value="">— load —</option>
          {rows.map((r) => (<option key={r.id} value={String(r.id)}>#{r.id} {r.name}</option>))}
        </select>
        <button onClick={handleLoad} type="button" style={S.btn}>Load</button>
        <button onClick={toggleIndicators} type="button" style={showIndicators ? S.btnPri : S.btn}>Indicators</button>
        <button onClick={toggleSignals} type="button" style={showSignals ? S.btnPri : S.btn}>Signals</button>
        {msg && <span style={S.msg}>{msg}</span>}
      </div>
      <DndContext collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Riga 1: Palette | Canvas (flex:1, stessa altezza di RunDialog) | RunDialog */}
        <div style={S.rowTop}>
          {showPalette && (
            <div style={S.palette}>
              <div style={{ fontSize: 12, color: '#8b949e', fontWeight: 700 }}>Palette</div>
              <div style={{ fontSize: 11, color: '#8b949e' }}>drag onto canvas</div>
              {NODE_TYPES.map((t) => (<PaletteCard key={t} type={t as NodeType} />))}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <TreeEditor />
          </div>
          <div style={S.runDialogCol}>
            <RunDialog onRunCreated={onRunCreated} />
          </div>
        </div>

        {/* Riga 2: Inspector | Indicators | Signals */}
        <div style={S.row}>
          <NodeInspector />
          {showIndicators && <IndicatorPanel />}
          {showSignals && <SignalPanel />}
        </div>

        <DragOverlay>{activeType ? <div style={{ ...S.card, opacity: 0.9 }}>{activeType}</div> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
