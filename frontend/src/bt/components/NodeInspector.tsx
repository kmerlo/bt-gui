import { useState, useEffect } from 'react'
import { useBtStore, findNode } from '../store/btStore'
import AlgoStack from './AlgoStack'

const S = {
  wrap: {
    width: 260,
    minWidth: 260,
    border: '1px solid #30363d',
    borderRadius: 8,
    background: '#0d1117',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 100px)',
  },
  title: { fontSize: 13, fontWeight: 700, color: '#c9d1d9' },
  label: { fontSize: 12, color: '#8b949e' },
  input: { background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' },
  textarea: {
    background: '#161b22',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '6px 8px',
    width: '100%',
    minHeight: 80,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  badge: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' },
}

export default function NodeInspector() {
  const tree = useBtStore((s) => s.tree)
  const selectedId = useBtStore((s) => s.selectedId)
  const updateNode = useBtStore((s) => s.updateNode)
  const removeNode = useBtStore((s) => s.removeNode)

  const node = tree && selectedId ? findNode(tree.root, selectedId) : null

  const [nameDraft, setNameDraft] = useState('')
  const [paramsDraft, setParamsDraft] = useState('')
  const [paramsErr, setParamsErr] = useState('')

  useEffect(() => {
    if (node) {
      setNameDraft(node.name)
      setParamsDraft(JSON.stringify(node.params ?? {}, null, 2))
      setParamsErr('')
    }
  }, [node?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // keep draft in sync if node changes externally (but not while editing name)
  // we only reset on id change above

  if (!tree) return <div style={S.wrap}>No tree</div>
  if (!node) return <div style={S.wrap}>Seleziona un nodo</div>

  const isStrategy = node.type === 'Strategy' || node.type === 'FixedIncomeStrategy'

  const commitName = () => {
    const v = nameDraft.trim()
    if (!v || v === node.name || !node.id) return
    updateNode(node.id!, { name: v })
  }

  const commitParams = () => {
    if (!node.id) return
    try {
      const parsed = paramsDraft.trim() ? (JSON.parse(paramsDraft) as Record<string, unknown>) : {}
      setParamsErr('')
      updateNode(node.id!, { params: parsed as unknown as typeof node.params })
    } catch (e) {
      setParamsErr(String(e))
    }
  }

  const isRoot = tree.root.id === node.id

  return (
    <div style={S.wrap}>
      <div style={S.title}>Inspector</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={S.badge}>{node.type}</span>
        <span style={S.label}>id {(node.id ?? '').slice(0, 8)}</span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={S.label}>name {node.type === 'Security' ? '(ticker = name)' : ''}</span>
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
          }}
          style={S.input}
        />
      </label>

      <div style={S.label}>type — cambio tipo non consentito v1 (ricrea il nodo)</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={S.label}>params (JSON)</span>
        <textarea value={paramsDraft} onChange={(e) => setParamsDraft(e.target.value)} onBlur={commitParams} style={S.textarea} />
        {paramsErr && <span style={{ color: '#f85149', fontSize: 12 }}>{paramsErr}</span>}
      </label>

      {isStrategy && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />
          <div style={S.label}>Algo Stack — {node.algos.length} algos</div>
          <AlgoStack nodeId={node.id!} />
          <div style={S.label}>children: {node.children.length}</div>
        </>
      )}

      {!isRoot && node.id && (
        <button
          onClick={() => removeNode(node.id!)}
          type="button"
          style={{ marginTop: 8, background: '#21262d', color: '#f85149', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}
        >
          Remove node
        </button>
      )}
    </div>
  )
}
