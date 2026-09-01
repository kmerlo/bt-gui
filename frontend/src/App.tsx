import { useEffect, useState } from 'react'
import BuilderView from './bt/components/BuilderView'
import DataManager from './bt/components/DataManager'
import DataDetailView from './bt/components/DataDetailView'
import IndicatorsView from './bt/components/IndicatorsView'
import SignalsView from './bt/components/SignalsView'
import ResultsDashboard from './bt/components/ResultsDashboard'
import SettingsView from './bt/components/SettingsView'
import StrategiesView from './bt/components/StrategiesView'
import { dbApi, type DbInfo } from './api/bt'

type View = 'builder' | 'results' | 'strategies' | 'data' | 'indicators' | 'signals' | 'data-detail' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('builder')
  const [runId, setRunId] = useState<number | null>(null)
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [detailPriceSymbol, setDetailPriceSymbol] = useState<string | null>(null)
  const [detailType, setDetailType] = useState<'indicator' | 'signal' | 'price' | null>(null)

  const refreshDb = () => dbApi.info().then(setDbInfo).catch(() => {})
  useEffect(() => { refreshDb() }, [])

  // sync hash ↔ view (read on mount, write on change)
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '') as View | ''
    if (
      h === 'builder' || h === 'results' || h === 'strategies' ||
      h === 'data' || h === 'indicators' || h === 'signals' || h === 'settings'
    ) {
      setView(h)
    }
  }, [])
  useEffect(() => {
    window.location.hash = view
  }, [view])

  // listen for View button clicks from IndicatorsView / SignalsView
  useEffect(() => {
    const onIndicator = (e: Event) => {
      const id = (e as CustomEvent).detail as number
      setDetailId(id)
      setDetailType('indicator')
      setView('data-detail')
    }
    const onSignal = (e: Event) => {
      const id = (e as CustomEvent).detail as number
      setDetailId(id)
      setDetailType('signal')
      setView('data-detail')
    }
    const onPrice = (e: Event) => {
      const symbol = (e as CustomEvent).detail as string
      setDetailPriceSymbol(symbol)
      setDetailType('price')
      setView('data-detail')
    }
    window.addEventListener('bt-navigate-indicator', onIndicator)
    window.addEventListener('bt-navigate-signal', onSignal)
    window.addEventListener('bt-navigate-price', onPrice)
    return () => {
      window.removeEventListener('bt-navigate-indicator', onIndicator)
      window.removeEventListener('bt-navigate-signal', onSignal)
      window.removeEventListener('bt-navigate-price', onPrice)
    }
  }, [])

  const handleSwitchDb = async (db: 'main' | 'test') => {
    if (dbInfo?.active === db) return
    if (!window.confirm(`Cambiare DB a "${db}"? La pagina verrà ricaricata per allineare Builder/Results.`)) return
    try {
      await dbApi.switch(db)
      window.location.reload()
    } catch (e) { alert(String(e)) }
  }

  const handleRunCreated = (id: number) => {
    setRunId(id)
    setView('results')
  }

  const NAV_ITEMS: { id: View; label: string }[] = [
    { id: 'builder', label: 'builder' },
    { id: 'results', label: 'results' },
    { id: 'strategies', label: 'strategies' },
    { id: 'data', label: 'data' },
    { id: 'indicators', label: 'indicators' },
    { id: 'signals', label: 'signals' },
    { id: 'settings', label: 'settings' },
  ]

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
        {NAV_ITEMS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            onContextMenu={(e) => {
              e.preventDefault()
              window.open(`${window.location.pathname}#${id}`, '_blank')
            }}
            style={{
              fontWeight: view === id ? '700' : '400',
              background: view === id ? '#21262d' : 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 10px',
              cursor: 'pointer',
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      {view === 'builder' && <BuilderView onRunCreated={handleRunCreated} />}
      {view === 'results' && <ResultsDashboard runId={runId} />}
      {view === 'data' && <DataManager onNavigate={(symbol) => window.dispatchEvent(new CustomEvent('bt-navigate-price', { detail: symbol }))} />}
      {view === 'indicators' && <IndicatorsView />}
      {view === 'signals' && <SignalsView />}
      {view === 'data-detail' && <DataDetailView selectedId={detailId} selectedType={detailType} priceSymbol={detailPriceSymbol} onBack={() => setView('indicators')} />}
      {view === 'strategies' && <StrategiesView />}
      {view === 'settings' && <SettingsView />}
    </div>
  )
}
