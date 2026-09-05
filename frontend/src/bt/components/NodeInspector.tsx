import { useState, useEffect, useRef } from 'react'
import { useBtStore, findNode } from '../store/btStore'
import AlgoStack from './AlgoStack'
import DateInputIT from './DateInputIT'

const S = {
  wrap: {
    width: 320,
    minWidth: 320,
    border: '1px solid #30363d',
    borderRadius: 8,
    background: '#0d1117',
    padding: 12,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
    boxSizing: 'border-box' as const,
    maxHeight: 'calc(100vh - 100px)',
  },
  title: { fontSize: 13, fontWeight: 700, color: '#c9d1d9' },
  label: { fontSize: 12, color: '#8b949e' },
  input: { background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%', wordBreak: 'break-all' as const },
  select: { background: '#161b22', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' },
  textarea: {
    background: '#161b22',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '6px 8px',
    width: '100%',
    wordBreak: 'break-all' as const,
    overflowX: 'hidden' as const,
    minHeight: 80,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  badge: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' },
  row: { display: 'flex', gap: 6, alignItems: 'center' } as const,
}

export default function NodeInspector() {
  const tree = useBtStore((s) => s.tree)
  const selectedId = useBtStore((s) => s.selectedId)
  const updateNode = useBtStore((s) => s.updateNode)
  const removeNode = useBtStore((s) => s.removeNode)
  const duplicateNode = useBtStore((s) => s.duplicateNode)
  const tickerStart = useBtStore((s) => s.tickerStart)
  const tickerEnd = useBtStore((s) => s.tickerEnd)
  const setTickerStart = useBtStore((s) => s.setTickerStart)
  const setTickerEnd = useBtStore((s) => s.setTickerEnd)

  const node = tree && selectedId ? findNode(tree.root, selectedId) : null

  const [nameDraft, setNameDraft] = useState('')
  const [paramsDraft, setParamsDraft] = useState('')
  const [paramsErr, setParamsErr] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (node) {
      setNameDraft(node.name)
      setParamsDraft(JSON.stringify(node.params ?? {}, null, 2))
      setParamsErr('')
    }
  }, [node?.id, node?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (node?.name.endsWith('_copy')) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [node?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // flush drafts before save (BuilderView dispatches 'bt-before-save')
  useEffect(() => {
    const flush = () => {
      // params
      if (node?.id) {
        try {
          const parsed = paramsDraft.trim() ? (JSON.parse(paramsDraft) as Record<string, unknown>) : {}
          updateNode(node.id!, { params: parsed as unknown as typeof node.params })
          setParamsErr('')
        } catch {
          /* keep error, don't overwrite store */
        }
        const v = nameDraft.trim()
        if (v && v !== node.name) updateNode(node.id!, { name: v })
      }
    }
    window.addEventListener('bt-before-save', flush)
    return () => window.removeEventListener('bt-before-save', flush)
  }, [node?.id, paramsDraft, nameDraft, updateNode, node?.name])

  // keep draft in sync if node changes externally (but not while editing name)
  // we only reset on id change above

  if (!tree) return <div style={S.wrap}>No tree</div>
  if (!node) return <div style={S.wrap}>Seleziona un nodo</div>

  const isStrategy = node.type === 'Strategy' || node.type === 'FixedIncomeStrategy'

  const commitName = () => {
    const v = nameDraft.trim()
    if (!v || !selectedId) return
    // ponytail: read fresh node from store to avoid stale closure after duplicate
    const fresh = tree && selectedId ? findNode(tree.root, selectedId) : null
    if (!fresh || v === fresh.name) return
    updateNode(selectedId, { name: v })
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

  const canSaveName = (() => {
    const v = nameDraft.trim()
    return Boolean(v && selectedId && tree && findNode(tree.root, selectedId)?.name !== v)
  })()

  return (
    <div style={S.wrap}>
      <div
        style={{
          position: 'sticky' as const,
          top: 0,
          zIndex: 1,
          background: '#0d1117',
          paddingBottom: 8,
          margin: '-12px -12px 0',
          padding: '12px 12px 8px',
          borderBottom: '1px solid #21262d',
          display: 'flex',
          flexDirection: 'column' as const,
          gap: 10,
        }}
      >
        <div style={S.title}>Inspector</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={S.badge}>{node.type}</span>
          <span style={S.label}>id {(node.id ?? '').slice(0, 8)}</span>
        </div>

        <div style={{ overflowX: 'hidden' }}>
          <span style={S.label}>name {node.type === 'Security' ? '(ticker = name)' : ''}</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName()
              }}
              style={{ ...S.input, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              onClick={commitName}
              disabled={!canSaveName}
              title={canSaveName ? 'Salva nome' : 'nessuna modifica'}
              style={{
                background: canSaveName ? '#238636' : '#21262d',
                color: canSaveName ? '#fff' : '#8b949e',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '6px 10px',
                cursor: canSaveName ? 'pointer' : 'default',
                opacity: canSaveName ? 1 : 0.6,
                whiteSpace: 'nowrap' as const,
                flexShrink: 0,
              }}
            >
              Salva nome
            </button>
          </div>
          <span style={{ fontSize: 11, color: '#8b949e' }}>Invio, click fuori o Salva nome</span>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <span style={S.label}>type</span>
          <span style={{ ...S.badge, opacity: 0.6 }}>{node.type} · sola lettura v1</span>
          <span style={{ fontSize: 11, color: '#8b949e' }}>per cambiare tipo: ricrea il nodo da palette</span>
        </div>
      </div>

      <div style={{ overflowX: 'hidden' }}>
        <span style={S.label}>params (JSON)</span>
        <textarea
          value={paramsDraft}
          onChange={(e) => {
            const v = e.target.value
            setParamsDraft(v)
            // ponytail: sync immediately when JSON valid, so Save before blur not lost
            try {
              const parsed = v.trim() ? (JSON.parse(v) as Record<string, unknown>) : {}
              setParamsErr('')
              if (node?.id) updateNode(node.id!, { params: parsed as unknown as typeof node.params })
            } catch (err) {
              setParamsErr(String(err))
            }
          }}
          onBlur={commitParams}
          style={S.textarea}
        />
        {paramsErr && <span style={{ color: '#f85149', fontSize: 12 }}>{paramsErr}</span>}
      </div>

      {!isStrategy && (
        <div style={{ background: '#1f2937', border: '1px solid #30363d', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#8b949e', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, color: '#c9d1d9', marginBottom: 4 }}>
            🔍 {node.type === 'Security' ? 'Nodo Security' : 'Tipo nodo'}
          </div>
          <div>L'Algo Stack appare solo per nodi di tipo <strong>Strategy</strong> o <strong>FixedIncomeStrategy</strong>.</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ color: '#58a6ff', cursor: 'pointer' }} onClick={() => {
              const rootId = tree.root.id
              if (rootId) useBtStore.getState().setSelected(rootId)
            }}>
              ↑ Clicca "MyStrategy" nell'albero per modificare l'Algo Stack
            </span>
          </div>
        </div>
      )}

      {isStrategy && (
        <>
          <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />
          <div style={S.label}>Algo Stack — {node.algos.length} algos</div>
          <AlgoStack nodeId={node.id!} />
          <div style={S.label}>children: {node.children.length}</div>

          {isRoot && (
            <>
              <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />
              <div style={S.label}>Date range</div>
              <div style={S.row}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>Start</span>
                  <DateInputIT value={tickerStart ?? ''} onChange={setTickerStart} style={S.input} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: '#8b949e' }}>End</span>
                  <DateInputIT value={tickerEnd ?? ''} onChange={setTickerEnd} style={S.input} />
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ borderTop: '1px solid #21262d', margin: '4px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={S.label}>Figli: {node.children.length}</span>
        <span style={S.label}>Id: {(node.id ?? '').slice(0, 8)}</span>
      </div>

      {!isRoot && node.id && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => duplicateNode(node.id!)}
            type="button"
            style={{ flex: 1, background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}
          >
            ⧉ Duplica
          </button>
          <button
            onClick={() => removeNode(node.id!)}
            type="button"
            style={{ flex: 1, background: '#21262d', color: '#f85149', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', cursor: 'pointer' }}
          >
            Remove node
          </button>
        </div>
      )}
    </div>
  )
}
