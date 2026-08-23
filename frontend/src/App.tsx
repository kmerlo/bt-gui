import { useState } from 'react'
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
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['builder', 'results', 'strategies', 'data', 'settings'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{ fontWeight: view === v ? '700' : '400' }}
            type="button"
          >
            {v}
          </button>
        ))}
        <button onClick={handleHealth} type="button">
          health
        </button>
        {health && <span>→ {health}</span>}
      </nav>
      <div>view: {view} — scaffold OK</div>
    </div>
  )
}
