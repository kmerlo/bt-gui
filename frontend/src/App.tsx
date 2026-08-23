import { useState } from 'react'
import BuilderView from './bt/components/BuilderView'
import DataManager from './bt/components/DataManager'
import ResultsDashboard from './bt/components/ResultsDashboard'
import RunDialog from './bt/components/RunDialog'
import { btApi } from './api/bt'

type View = 'builder' | 'results' | 'strategies' | 'data' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [health, setHealth] = useState('')
  const [runId, setRunId] = useState<number | null>(null)

  const handleHealth = () => {
    btApi
      .health()
      .then((r) => setHealth(r.status))
      .catch((e: unknown) => setHealth(String(e)))
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', background: '#010409', color: '#c9d1d9', minHeight: '100vh' }}>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['builder', 'results', 'strategies', 'data', 'settings'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              fontWeight: view === v ? '700' : '400',
              background: view === v ? '#21262d' : 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 10px',
              cursor: 'pointer',
            }}
            type="button"
          >
            {v}
          </button>
        ))}
        <button
          onClick={handleHealth}
          type="button"
          style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}
        >
          health
        </button>
        {health && <span>→ {health}</span>}
      </nav>
      {view === 'builder' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <BuilderView />
          </div>
          <div style={{ width: 340, minWidth: 300 }}>
            <RunDialog
              onRunCreated={(id) => {
                setRunId(id)
                setView('results')
              }}
            />
          </div>
        </div>
      )}
      {view === 'results' && <ResultsDashboard runId={runId} />}
      {view === 'data' && <DataManager />}
      {view === 'strategies' && <div>strategies — use Builder save/load</div>}
      {view === 'settings' && <div>settings — scaffold OK</div>}
    </div>
  )
}
