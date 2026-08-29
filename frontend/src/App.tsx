import { useEffect, useState } from 'react'
import BuilderView from './bt/components/BuilderView'
import DataManager from './bt/components/DataManager'
import DataDetailView from './bt/components/DataDetailView'
import ResultsDashboard from './bt/components/ResultsDashboard'
import SettingsView from './bt/components/SettingsView'
import StrategiesView from './bt/components/StrategiesView'
import RunDialog from './bt/components/RunDialog'
import { dbApi, type DbInfo } from './api/bt'

type View = 'builder' | 'results' | 'strategies' | 'data' | 'data-detail' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [runId, setRunId] = useState<number | null>(null)
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)

  const refreshDb = () => dbApi.info().then(setDbInfo).catch(() => {})
  useEffect(() => { refreshDb() }, [])
  // refresh DB info when view changes (so counts stay fresh)
  useEffect(() => { refreshDb() }, [view])

  const handleSwitchDb = async (db: 'main' | 'test') => {
    if (dbInfo?.active === db) return
    if (!window.confirm(`Cambiare DB a "${db}"? La pagina verrà ricaricata per allineare Builder/Results.`)) return
    try {
      await dbApi.switch(db)
      window.location.reload()
    } catch (e) { alert(String(e)) }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui', background: '#010409', color: '#c9d1d9', minHeight: '100vh' }}>
      {/* DB selector in testa — sempre visibile */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, padding: '8px 10px', border: '1px solid #30363d', borderRadius: 8, background: dbInfo?.active === 'test' ? '#1a2332' : '#0d1117' }}>
        <span style={{ fontSize: 12, color: '#8b949e', fontWeight: 700 }}>DB:</span>
        {(['main', 'test'] as const).map((db) => {
          const active = dbInfo?.active === db
          const counts = dbInfo?.dbs.find((d) => d.name === db)?.counts
          return (
            <button
              key={db}
              onClick={() => handleSwitchDb(db)}
              style={{
                background: active ? (db === 'test' ? '#1f6feb' : '#238636') : '#21262d',
                color: active ? '#fff' : '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: 999,
                padding: '4px 10px',
                cursor: 'pointer',
                fontWeight: active ? 700 : 400,
                fontSize: 12,
              }}
              type="button"
              title={db === 'main' ? 'DB principale (dati utente)' : 'DB test (usato da pytest, isolato)'}
            >
              {db === 'main' ? '● main' : '🧪 test'} {active ? '✓' : ''} {counts ? `(${counts.strategies} strat, ${counts.data_sources} ds, ${counts.runs} runs)` : ''}
            </button>
          )
        })}
        <span style={{ fontSize: 11, color: '#8b949e', marginLeft: 8 }}>
          {dbInfo?.active === 'test' ? 'Stai usando il DB di test — i dati utente in main sono al sicuro.' : 'DB principale — i test useranno comunque test (isolato).'}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={refreshDb} type="button" style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11 }}>↻</button>
      </div>

      <nav style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {(['builder', 'results', 'strategies', 'data', 'data-detail', 'settings'] as View[]).map((v) => (
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
  {/* health moved to Settings */}

      </nav>
      {view === 'builder' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <BuilderView />
          </div>
          <div style={{ width: 340, minWidth: 300, alignSelf: 'flex-start', marginTop: 44 }}>
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
      {view === 'data-detail' && <DataDetailView />}
      {view === 'strategies' && <StrategiesView />}
      {view === 'settings' && <SettingsView />}
    </div>
  )
}
