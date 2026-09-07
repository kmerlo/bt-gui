import { useCallback, useEffect, useRef, useState } from 'react'
import { backtestApi, priceDataApi } from '../../api/bt'
import type { NodeConfig } from '../../types/bt'
import { useBtStore } from '../store/btStore'
import { collectReferencedIds } from '../utils/collectIds'
import { collectTickers } from '../utils/collectTickers'
import DateInputIT from './DateInputIT'
import CommissionField from './CommissionField'
import { resolveCommissionFn, validateCommission } from '../utils/commission'
import type { CommissionFlags, CommissionParams } from '../utils/commission'
import TaxPanel, { validateTaxRate } from './TaxPanel'

const S = {
  wrap: { border: '1px solid #30363d', borderRadius: 8, padding: 12, background: '#0d1117', color: '#c9d1d9' } as const,
  input: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  select: { background: '#010409', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: '100%' } as const,
  btn: { background: '#238636', color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' } as const,
  btnDis: { background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, padding: '8px 14px' } as const,
  label: { fontSize: 12, color: '#8b949e', marginBottom: 4, display: 'block' } as const,
}

export default function RunDialog({ onRunCreated }: { onRunCreated?: (id: number) => void }) {
  const tree = useBtStore((s) => s.tree)
  const tickerStart = useBtStore((s) => s.tickerStart)
  const tickerEnd = useBtStore((s) => s.tickerEnd)
  const setTickerStart = useBtStore((s) => s.setTickerStart)
  const setTickerEnd = useBtStore((s) => s.setTickerEnd)
  const backtestConfig = useBtStore((s) => s.backtestConfig)
  const setBacktestConfig = useBtStore((s) => s.setBacktestConfig)
  const extraSourceIds = useBtStore((s) => s.extraSourceIds)
  const indicatorSourceIds = useBtStore((s) => s.indicatorSourceIds)
  const setIndicatorSourceIds = useBtStore((s) => s.setIndicatorSourceIds)
  const [availableTickers, setAvailableTickers] = useState<string[]>([])
  const [selectedTickers, setSelectedTickers] = useState<string[]>([])
  const initDone = useRef(false)
  const [msg, setMsg] = useState('')
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<number | null>(null)
  const [indicatorWarnings, setIndicatorWarnings] = useState<string[]>([])
  const abortRef = useRef({ stopped: false, pollTimer: -1 as number })
  const wsRef = useRef<WebSocket | null>(null)
  const capital = backtestConfig.initial_capital
  const integerPos = backtestConfig.integer_positions
  const simpleFn = backtestConfig.simple_fn
  const commParams: CommissionParams = {
    my_commissions_min: backtestConfig.my_commissions_min,
    my_commissions_max: backtestConfig.my_commissions_max,
    my_commissions_perc: backtestConfig.my_commissions_perc,
  }
  const commFlags: CommissionFlags = {
    commission_formula_enabled: backtestConfig.commission_formula_enabled,
    commission_params_enabled: backtestConfig.commission_params_enabled,
  }
  const benchmarkTicker = backtestConfig.benchmark_ticker ?? 'SPY'

  const refreshTickers = useCallback(async () => {
    try {
      const rows = await priceDataApi.list()
      setAvailableTickers(rows.map((r) => r.symbol))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshTickers()
    const handler = () => refreshTickers()
    window.addEventListener('bt-price-refresh', handler)
    return () => window.removeEventListener('bt-price-refresh', handler)
  }, [refreshTickers])

  // Auto-select all tree tickers that have data available — auto-adds new tickers as they appear
  useEffect(() => {
    initDone.current = false
  }, [tree])
  useEffect(() => {
    const ids = tree ? collectTickers(tree.root) : []
    const known = ids.filter((t) => availableTickers.includes(t))
    if (known.length === 0) return
    if (!initDone.current) {
      initDone.current = true
      setSelectedTickers(known)
    } else if (known.length !== selectedTickers.length || known.some((t) => !selectedTickers.includes(t))) {
      // ponytail: auto-select new ticker, keep order of known (user asked always all)
      setSelectedTickers(known)
    }
  }, [availableTickers, tree, selectedTickers])

  useEffect(() => {
    const id = runId
    if (id == null) return
    // ponytail: no FE key store exists — read operator-set localStorage['bt-api-key'] if present, else plain URL
    let apiKey: string | undefined
    try { apiKey = localStorage.getItem('bt-api-key') ?? undefined } catch { apiKey = undefined }
    const ws = backtestApi.wsProgress(id, apiKey)
    wsRef.current = ws
    abortRef.current = { stopped: false, pollTimer: -1 }
    const onMsg = (ev: MessageEvent) => {
      try {
        const d = JSON.parse(ev.data as string) as { progress: number; done: boolean; error?: string }
        setProgress(d.progress)
        if (d.error) setMsg('backtest failed')
        if (d.done) { ws.close(); setRunning(false); setProgress(1) }
      } catch { /* ignore */ }
    }
    const onErr = () => {
      let tries = 0
      const poll = async () => {
        if (abortRef.current.stopped) return
        tries++
        try {
          const r = await backtestApi.getRun(id)
          if (r.stats) { setProgress(1); setRunning(false); return }
        } catch { /* ignore */ }
        if (tries >= 30) { setRunning(false); return }
        abortRef.current.pollTimer = window.setTimeout(poll, 500) as unknown as number
      }
      abortRef.current.pollTimer = window.setTimeout(poll, 1000) as unknown as number
    }
    ws.addEventListener('message', onMsg)
    ws.addEventListener('error', onErr)
    const onClose = (ev: CloseEvent) => {
      if (ev.code === 4401) { setMsg('unauthorized: set localStorage bt-api-key and retry'); setRunning(false) }
    }
    ws.addEventListener('close', onClose)
    return () => {
      abortRef.current.stopped = true
      if (abortRef.current.pollTimer) window.clearTimeout(abortRef.current.pollTimer)
      ws.close()
      ws.removeEventListener('message', onMsg)
      ws.removeEventListener('error', onErr)
      ws.removeEventListener('close', onClose)
      wsRef.current = null
    }
  }, [runId])

  // ponytail: validazione completa al salvataggio/run (BE); qui solo forma + regola flag
  const fnError = validateCommission(simpleFn, commParams, commFlags)

  const toggleTicker = (sym: string) => {
    setSelectedTickers((prev) => prev.includes(sym) ? prev.filter((t) => t !== sym) : [...prev, sym])
  }

  const treeTickers = tree ? collectTickers(tree.root) : []
  const missingTickers = treeTickers.filter((t) => !availableTickers.includes(t))
  const coverageMismatch = treeTickers.length > 0 && selectedTickers.length !== treeTickers.length

  const handleRun = async () => {
    if (!tree) { setMsg('no tree'); return }
    if (selectedTickers.length === 0) { setMsg('select at least one ticker'); return }
    if (fnError) { setMsg(fnError); return }
    if (backtestConfig.tax_enabled && (validateTaxRate(backtestConfig.tax_gain_rate) || validateTaxRate(backtestConfig.tax_div_rate))) {
      setMsg('aliquota fiscale 0..100'); return
    }
    if (missingTickers.length > 0) {
      const ok = window.confirm(
        `Dati mancanti per: ${missingTickers.join(', ')} — fetch in Ticker Catalog.\n` +
        `Price column: ${backtestConfig.price_column === 'adj_close' ? 'Adj Close' : 'Close'} (da Settings → Sorgente dati).\n` +
        `Continuare comunque?`
      )
      if (!ok) return
    }
    if (coverageMismatch) {
      const ok = window.confirm(
        `Stai per lanciare con price parziale: ${selectedTickers.length}/${treeTickers.length} ticker selezionati.\n` +
        `Tree: ${treeTickers.join(', ')}\nPrice: ${selectedTickers.join(', ')}\n` +
        `Price column: ${backtestConfig.price_column === 'adj_close' ? 'Adj Close' : 'Close'} (da Settings → Sorgente dati).\n` +
        `I ticker esclusi avranno price=0 e il backtest fallirà con "Cannot allocate capital...".\n` +
        `Vuoi continuare lo stesso?`
      )
      if (!ok) return
    }
    // ponytail: senza Rebalance i pesi Weigh* non diventano mai ordini — equity piatta senza errori dal BE
    const missingRebalance: string[] = []
    {
      const walk = (n: NodeConfig) => {
        if (n.type === 'Strategy' || n.type === 'FixedIncomeStrategy') {
          const hasReb = (n.algos ?? []).some((a) => a.class_name.startsWith('Rebalance'))
          if (!hasReb) missingRebalance.push(n.name)
        }
        for (const c of n.children ?? []) walk(c)
      }
      walk(tree.root)
    }
    if (missingRebalance.length > 0) {
      const ok = window.confirm(
        `Manca l'algo Rebalance in: ${missingRebalance.join(', ')}.\n` +
        `Senza Rebalance (o RebalanceAlways/RebalanceOverTime) i pesi calcolati da Weigh* non diventano mai ordini: il backtest gira ma l'equity resta piatta.\n` +
        `Aggiungi Rebalance come ultimo algo dello Stack.\n` +
        `Continuare comunque?`
      )
      if (!ok) return
    }
    setRunning(true)
    setProgress(0.05)
    setRunId(null)
    setMsg('')
    const config = {
      initial_capital: capital,
      integer_positions: integerPos,
      commission: { type: 'simple', simple_fn: resolveCommissionFn(simpleFn, commParams, commFlags) || null },
      start: tickerStart,
      end: tickerEnd,
      price_column: backtestConfig.price_column,
      tax: {
        enabled: backtestConfig.tax_enabled,
        default_gain_rate: backtestConfig.tax_gain_rate,
        default_div_rate: backtestConfig.tax_div_rate,
        use_loss_carry: backtestConfig.tax_use_carry,
      },
    }
    // ponytail: mapping profili solo per ticker selezionati
    const tickerTaxProfiles: Record<string, number> = {}
    for (const t of selectedTickers) {
      const pid = backtestConfig.ticker_tax_profile[t]
      if (pid != null) tickerTaxProfiles[t] = pid
    }
    // ponytail: walk condiviso in utils/collectIds (include preset salvati)
    const referencedIds = [...new Set([...indicatorSourceIds, ...collectReferencedIds(tree)])].sort((a, b) => a - b)
    if (referencedIds.length !== indicatorSourceIds.length || referencedIds.some((id, i) => id !== indicatorSourceIds[i])) {
      setIndicatorSourceIds(referencedIds)
    }
    try {
      const res = await backtestApi.create({
        tree,
        config,
        tickers: selectedTickers,
        benchmark_ticker: benchmarkTicker.trim().toUpperCase() || null,
        extra_source_ids: extraSourceIds,
        indicator_source_ids: referencedIds,
        ticker_tax_profiles: tickerTaxProfiles,
      })
      onRunCreated?.(res.id)
      if (res.warnings?.length) {
        setIndicatorWarnings(res.warnings)
        setMsg(`run #${res.id} started (⚠️ ${res.warnings.length} warning(i))`)
      } else {
        setMsg(`run #${res.id} started`)
      }
      setRunId(res.id)
    } catch (e) {
      setMsg(String(e))
      setRunning(false)
    }
  }

  return (
    <div style={S.wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontWeight: 700 }}>Run Backtest</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            onClick={refreshTickers}
            title="Ricarica lista ticker dal DB (dopo Fetch in Ticker Catalog)"
            style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
          >
            ↻
          </button>
          <span
            title="Impostato in Settings → Sorgente dati → Price column"
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#21262d', border: '1px solid #30363d', color: '#8b949e' }}
          >
            {backtestConfig.price_column === 'adj_close' ? 'Adj Close' : 'Close'}
          </span>
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>
        Price column: <b style={{ color: '#c9d1d9' }}>{backtestConfig.price_column === 'adj_close' ? 'Adj Close' : 'Close'}</b>
        <span style={{ marginLeft: 6 }}>· da Settings → Sorgente dati</span>
      </div>
      <label style={S.label}>Tickers</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
        {treeTickers.length === 0 && <span style={{ fontSize: 12, color: '#8b949e' }}>Nessun ticker nella strategia — aggiungi Security alla tree</span>}
        {treeTickers.length > 0 && availableTickers.filter((sym) => treeTickers.includes(sym)).length === 0 && <span style={{ fontSize: 12, color: '#8b949e' }}>Nessun dato disponibile per i ticker della strategia</span>}
        {availableTickers.filter((sym) => treeTickers.includes(sym)).map((sym) => (
          <button
            key={sym}
            type="button"
            onClick={() => toggleTicker(sym)}
            style={{
              background: selectedTickers.includes(sym) ? '#238636' : '#21262d',
              color: selectedTickers.includes(sym) ? '#fff' : '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {sym}
          </button>
        ))}
      </div>
      {missingTickers.length > 0 && (
        <div style={{ fontSize: 11, color: '#f85149', marginBottom: 4 }}>
          Dati mancanti per: {missingTickers.join(', ')} — fetch in Ticker Catalog
        </div>
      )}
      {coverageMismatch && (
        <div style={{ fontSize: 11, color: '#f0c040', marginBottom: 4 }}>
          Attenzione: price contiene {selectedTickers.length}/{treeTickers.length} ticker della tree — selezione parziale può dare price=0 su ticker esclusi
        </div>
      )}
      <label style={{ ...S.label, marginTop: 8 }}>Start date</label>
      <DateInputIT value={tickerStart ?? ''} onChange={setTickerStart} style={S.input} />
      <label style={{ ...S.label, marginTop: 8 }}>End date</label>
      <DateInputIT value={tickerEnd ?? ''} onChange={setTickerEnd} style={S.input} />
      <label style={{ ...S.label, marginTop: 8 }}>Benchmark ticker (buy&amp;hold)</label>
      <input
        style={{ ...S.input, textTransform: 'uppercase' }}
        value={benchmarkTicker}
        onChange={(e) => setBacktestConfig({ benchmark_ticker: e.target.value.toUpperCase() })}
        placeholder="SPY"
        title="Comprato a inizio strategia e tenuto buy&hold — linea di confronto sull'equity. Vuoto = nessun benchmark."
      />
      <label style={{ ...S.label, marginTop: 8 }}>Initial capital</label>
      <input style={S.input} type="number" value={capital} onChange={(e) => setBacktestConfig({ initial_capital: Number(e.target.value) })} />
      <label style={{ ...S.label, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={integerPos} onChange={(e) => setBacktestConfig({ integer_positions: e.target.checked })} />
        integer positions
      </label>
      <label style={{ ...S.label, marginTop: 8 }}>Commissioni</label>
      <CommissionField
        formula={simpleFn}
        params={commParams}
        flags={commFlags}
        onFormula={(v) => setBacktestConfig({ simple_fn: v })}
        onParams={(p) => setBacktestConfig(p)}
        onFlags={(f) => setBacktestConfig(f)}
        error={fnError}
      />
      <TaxPanel tickers={selectedTickers} />
      <button type="button" style={running ? S.btnDis : S.btn} onClick={handleRun} disabled={running}>
        {running ? 'Running…' : 'Run'}
      </button>
      {running && (
        <div style={{ marginTop: 8, background: '#21262d', borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(progress * 100)}%`, background: '#238636', height: '100%' }} />
        </div>
      )}
      {indicatorWarnings.length > 0 && (
        <div style={{ marginTop: 8, background: '#3d2c00', border: '1px solid #9e6a16', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#f0c040', lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Indicatori obsoleti rilevati</div>
          {indicatorWarnings.map((w, i) => <div key={i}>{w}</div>)}
          <div style={{ marginTop: 6, color: '#c9d1d9' }}>
            Per risolvere: vai nella sezione <b>Indicators</b>, seleziona il ticker interessato e premi <b>Compute & Save</b> per ricalcolare con i dati più recenti.
          </div>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
