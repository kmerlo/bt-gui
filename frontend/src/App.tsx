import { useState } from 'react'
import BuilderView from './bt/components/BuilderView'
import { btApi } from './api/bt'

type View = 'builder' | 'results' | 'strategies' | 'data' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [health, setHealth] = useState('')

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
      {view === 'builder' && <BuilderView />}
      {view !== 'builder' && <div>view: {view} — scaffold OK</div>}
    </div>
  )
}
