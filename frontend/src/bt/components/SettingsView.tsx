import { useEffect, useState } from 'react'
import { btApi, strategiesApi, backtestApi, dbApi, loadSettings, saveSettings, defaultSettings, type BtSettings, type DbInfo } from '../../api/bt'

const S = {
  wrap: { padding: 12, color: '#c9d1d9' } as const,
  card: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  h: { margin: '0 0 8px', fontSize: 14, fontWeight: 700 } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 8 } as const,
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px' } as const,
  textarea: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%', fontFamily: 'monospace', fontSize: 12 } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnPri: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  btnDanger: { background: '#da3633', color: '#fff', border: '1px solid #f85149', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  label: { fontSize: 12, color: '#8b949e', minWidth: 140 } as const,
  kv: { fontSize: 13 } as const,
  msgOk: { fontSize: 12, color: '#3fb950' } as const,
  msgErr: { fontSize: 12, color: '#f85149' } as const,
  badgeOk: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#1a3d1a', border: '1px solid #2ea043', color: '#3fb950' } as const,
  badgeErr: { fontSize: 11, padding: '2px 6px', borderRadius: 999, background: '#3d1a1a', border: '1px solid #f85149', color: '#f85149' } as const,
}

export default function SettingsView() {
  const [settings, setSettings] = useState<BtSettings>(defaultSettings)
  const [health, setHealth] = useState<{ status: string; version: string; db: string; db_error: string | null; counts: { strategies: number; data_sources: number; runs: number } } | null>(null)
  const [healthMsg, setHealthMsg] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [dbMsg, setDbMsg] = useState('')

  useEffect(() => {
    setSettings(loadSettings())
    handleHealth()
    handleDbInfo()
  }, [])

  const handleHealth = async () => {
    setHealthMsg('')
    try {
      const h = await btApi.health()
      setHealth(h)
    } catch (e) {
      setHealthMsg(String(e))
    }
  }

  const handleDbInfo = async () => {
    try {
      const info = await dbApi.info()
      setDbInfo(info)
    } catch (e) { setDbMsg(String(e)) }
  }
  const handleSwitchDb = async (db: 'main' | 'test') => {
    if (dbInfo?.active === db) return
    if (!window.confirm(`Cambiare DB a "${db}"? Verrà ricaricata la pagina.`)) return
    try {
      await dbApi.switch(db)
      setDbMsg(`switched to ${db} — ricarico...`)
      setTimeout(() => window.location.reload(), 500)
    } catch (e) { setDbMsg(String(e)) }
  }

  const handleSave = () => {
    if (settings.simple_fn.trim()) {
      const ok = /^\s*lambda\s+\w+\s*,\s*\w+\s*:/.test(settings.simple_fn)
      if (!ok) {
        setSaveMsg('simple_fn deve essere lambda (q,p) — es: lambda q,p: q*p*0.001')
        return
      }
      // validazione completa al salvataggio (BE)
    }
    saveSettings(settings)
    setSaveMsg('salvato')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  const handleResetDefaults = () => {
    setSettings(defaultSettings)
    saveSettings(defaultSettings)
    setSaveMsg('ripristinati default')
  }

  const handleClearRuns = async () => {
    if (!window.confirm('Eliminare tutti i run?')) return
    setBusy(true)
    try {
      const rows = await backtestApi.listRuns()
      if (rows.length === 0) { setHealthMsg('nessun run da eliminare'); return }
      const r = await backtestApi.bulkDeleteRuns(rows.map((x) => x.id))
      setHealthMsg(`eliminati ${r.deleted} run`)
      handleHealth()
    } catch (e) { setHealthMsg(String(e)) } finally { setBusy(false) }
  }

  const handleExport = async () => {
    try {
      const rows = await strategiesApi.list()
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'strategies_export.json'; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setHealthMsg(String(e)) }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      const list = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [parsed as Record<string, unknown>]
      let ok = 0
      for (const item of list) {
        const tree = (item.tree ?? item) as unknown as Record<string, unknown>
        // try to create via API
        await strategiesApi.create(tree as never)
        ok++
      }
      setHealthMsg(`importate ${ok} strategie`)
      handleHealth()
    } catch (err) { setHealthMsg(String(err)) }
    e.target.value = ''
  }

  return (
    <div style={S.wrap}>
      <h3 style={{ margin: '0 0 12px' }}>Settings</h3>

      {/* DB selector (richiesto in testa a Settings) */}
      <div style={S.card}>
        <div style={S.h}>Database</div>
        <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
          <b>main</b> = dati utente (al sicuro) · <b>test</b> = DB isolato per i test automatici (`bt_gui_test.db`). `pytest` usa sempre <b>test</b> (vedi `tests/conftest.py`), quindi i tuoi dati in main non vengono mai toccati. Puoi cambiare qui o dalla barra in cima a tutte le pagine.
        </div>
        {dbInfo ? (
          <div style={S.row}>
            {dbInfo.dbs.map((d) => {
              const active = dbInfo.active === d.name
              return (
                <button
                  key={d.name}
                  onClick={() => handleSwitchDb(d.name as 'main' | 'test')}
                  style={{
                    background: active ? (d.name === 'test' ? '#1f6feb' : '#238636') : '#21262d',
                    color: active ? '#fff' : '#c9d1d9',
                    border: '1px solid #30363d',
                    borderRadius: 999,
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontWeight: active ? 700 : 400,
                  }}
                  type="button"
                >
                  {d.name === 'main' ? '● main' : '🧪 test'} {active ? '✓ attivo' : ''} — {d.counts.strategies} strat · {d.counts.data_sources} ds · {d.counts.runs} runs — {d.file}
                </button>
              )
            })}
            <button type="button" style={S.btn} onClick={handleDbInfo}>↻ Refresh</button>
          </div>
        ) : <div style={{ fontSize: 12, color: '#8b949e' }}>caricamento DB...</div>}
        {dbMsg && <div style={dbMsg.startsWith('switched') ? S.msgOk : S.msgErr}>{dbMsg}</div>}
      </div>

      {/* Health / System */}
      <div style={S.card}>
        <div style={S.h}>Sistema / Health</div>
        <div style={S.row}>
          <button type="button" style={S.btn} onClick={handleHealth}>Check Health</button>
          {health && (
            <>
              <span style={health.status === 'ok' ? S.badgeOk : S.badgeErr}>status: {health.status}</span>
              <span style={health.db === 'ok' ? S.badgeOk : S.badgeErr}>db: {health.db}</span>
              <span style={{ fontSize: 12, color: '#8b949e' }}>v{health.version}</span>
              {health.db_error && <span style={S.msgErr}>{health.db_error}</span>}
            </>
          )}
        </div>
        {health && (
          <div style={{ ...S.row, marginTop: 8 }}>
            <span style={S.kv}>strategie: <b>{health.counts.strategies}</b></span>
            <span style={S.kv}>data sources: <b>{health.counts.data_sources}</b></span>
            <span style={S.kv}>runs: <b>{health.counts.runs}</b></span>
            <span style={{ fontSize: 11, color: '#8b949e' }}>API {btApi ? 'ok' : 'ko'} · WS {health.status === 'ok' ? 'ok' : '—'}</span>
          </div>
        )}
        {healthMsg && <div style={healthMsg.startsWith('eliminati') || healthMsg.startsWith('importate') ? S.msgOk : S.msgErr}>{healthMsg}</div>}
        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>Health verifica: FE→BE (fetch /api/bt/health), BE→DB (SELECT 1), conteggi tabelle. Il vecchio bottone in nav è stato spostato qui.</div>
      </div>

      {/* Backtest defaults */}
      <div style={S.card}>
        <div style={S.h}>Backtest defaults</div>
        <div style={S.row}>
          <span style={S.label}>Initial capital</span>
          <input style={S.input} type="number" value={settings.initial_capital} onChange={(e) => setSettings({ ...settings, initial_capital: Number(e.target.value) })} />
        </div>
        <div style={S.row}>
          <span style={S.label}>Integer positions</span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={settings.integer_positions} onChange={(e) => setSettings({ ...settings, integer_positions: e.target.checked })} /> abilita</label>
        </div>
        <div style={S.row}>
          <span style={S.label}>Price column default</span>
          <select style={S.input} value={settings.price_column} onChange={(e) => setSettings({ ...settings, price_column: e.target.value as 'close' | 'adj_close' })}>
            <option value="adj_close">Adj Close</option>
            <option value="close">Close</option>
          </select>
        </div>
        <div style={{ marginBottom: 8 }}>
          <div style={S.label}>Commission simple_fn</div>
          <textarea style={S.textarea} rows={2} placeholder="lambda q,p: max(1, abs(q)*0.01)" value={settings.simple_fn} onChange={(e) => setSettings({ ...settings, simple_fn: e.target.value })} />
          <div style={{ fontSize: 11, color: '#8b949e' }}>lascia vuoto per nessuna commissione. Deve accettare (q,p).</div>
        </div>
        <div style={S.row}>
          <button type="button" style={S.btnPri} onClick={handleSave}>Salva defaults</button>
          <button type="button" style={S.btn} onClick={handleResetDefaults}>Ripristina</button>
          {saveMsg && <span style={saveMsg === 'salvato' || saveMsg.startsWith('riprist') ? S.msgOk : S.msgErr}>{saveMsg}</span>}
        </div>
      </div>

      {/* Aspetto */}
      <div style={S.card}>
        <div style={S.h}>Aspetto</div>
        <div style={S.row}>
          <span style={S.label}>Theme</span>
          <select style={S.input} value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value as BtSettings['theme'] })}>
            <option value="dark">dark</option>
          </select>
          <span style={{ fontSize: 11, color: '#8b949e' }}>solo dark in v1</span>
        </div>
        <div style={S.row}>
          <span style={S.label}>Lingua</span>
          <select style={S.input} value={settings.lang} onChange={(e) => setSettings({ ...settings, lang: e.target.value as BtSettings['lang'] })}>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* Dati */}
      <div style={S.card}>
        <div style={S.h}>Dati</div>
        <div style={S.row}>
          <span style={S.label}>Adapter</span>
          <select style={S.input} value={settings.data_adapter} onChange={(e) => setSettings({ ...settings, data_adapter: e.target.value as BtSettings['data_adapter'] })}>
            <option value="ffn">ffn</option>
            <option value="yfinance">yfinance</option>
          </select>
          <span style={{ fontSize: 11, color: '#8b949e' }}>ffn → data_sources (parquet_blob); yfinance → price_data (tabellare)</span>
        </div>
        <div style={S.row}>
          <button type="button" style={S.btnPri} onClick={handleSave}>Salva</button>
        </div>
      </div>

      {/* Manutenzione */}
      <div style={S.card}>
        <div style={S.h}>Manutenzione</div>
        <div style={S.row}>
          <button type="button" style={busy ? S.btn : S.btnDanger} disabled={busy} onClick={handleClearRuns}>Clear runs</button>
          <button type="button" style={S.btn} onClick={handleExport}>Export strategie (JSON)</button>
          <label style={S.btn}>
            Import strategie
            <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          </label>
        </div>
        <div style={{ fontSize: 11, color: '#8b949e' }}>Export scarica tutte le strategie salvate; Import accetta un file JSON (singola o array) e le ricrea via API.</div>
      </div>
    </div>
  )
}
