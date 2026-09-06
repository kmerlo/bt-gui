import { useEffect, useState } from 'react'
import { taxProfilesApi, type TaxProfile } from '../../api/tax'

const S = {
  box: { border: '1px solid #30363d', borderRadius: 8, background: '#0d1117', padding: 12, marginBottom: 12 } as const,
  input: { background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 8px', width: 110 } as const,
  btn: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' } as const,
  td: { border: '1px solid #30363d', padding: 6, fontSize: 13 } as const,
}

export default function TaxProfilesPanel() {
  const [rows, setRows] = useState<TaxProfile[]>([])
  const [name, setName] = useState('')
  const [gain, setGain] = useState('26')
  const [div, setDiv] = useState('26')
  const [editing, setEditing] = useState<number | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = () => taxProfilesApi.list().then(setRows).catch((e) => setMsg(String(e)))
  useEffect(() => { refresh() }, [])

  const validRates = (g: number, d: number) => Number.isFinite(g) && Number.isFinite(d) && g >= 0 && g <= 100 && d >= 0 && d <= 100

  const startEdit = (p: TaxProfile) => {
    setEditing(p.id)
    setName(p.name)
    setGain(String(p.gain_rate))
    setDiv(String(p.div_rate))
    setMsg('')
  }
  const cancel = () => {
    setEditing(null)
    setName('')
    setGain('26')
    setDiv('26')
    setMsg('')
  }
  const save = async () => {
    const g = Number(gain)
    const d = Number(div)
    if (!name.trim()) { setMsg('nome richiesto'); return }
    if (!validRates(g, d)) { setMsg('aliquote 0..100'); return }
    try {
      if (editing == null) await taxProfilesApi.create({ name: name.trim(), gain_rate: g, div_rate: d })
      else await taxProfilesApi.update(editing, { name: name.trim(), gain_rate: g, div_rate: d })
      cancel()
      refresh()
    } catch (e) { setMsg(String(e)) }
  }
  const remove = async (id: number) => {
    // ponytail: delete sicura — i run salvano uno snapshot, mai FK
    if (!window.confirm(`Eliminare profilo #${id}? I run esistenti restano invariati (snapshot).`)) return
    try { await taxProfilesApi.remove(id); refresh() } catch (e) { setMsg(String(e)) }
  }

  return (
    <div style={S.box}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Profili fiscali</div>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>
        Aliquote riusabili per ticker (es. Governativi 12,5%, USA dividendi 37%).
        L'associazione ticker→profilo si fa nel box Run Backtest; ogni run salva uno snapshot.
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead><tr><th style={S.td}>Nome</th><th style={S.td}>Gain %</th><th style={S.td}>Div %</th><th style={S.td}>Azioni</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td style={S.td}>{p.name}</td><td style={S.td}>{p.gain_rate}</td><td style={S.td}>{p.div_rate}</td>
              <td style={S.td}>
                <button type="button" style={S.btn} onClick={() => startEdit(p)}>Modifica</button>{' '}
                <button type="button" style={S.btn} onClick={() => remove(p.id)}>Elimina</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...S.input, width: 160 }} placeholder="nome profilo" value={name} onChange={(e) => setName(e.target.value)} />
        <span style={{ fontSize: 12 }}>Gain % <input style={S.input} type="number" min={0} max={100} step={0.5} value={gain} onChange={(e) => setGain(e.target.value)} /></span>
        <span style={{ fontSize: 12 }}>Div % <input style={S.input} type="number" min={0} max={100} step={0.5} value={div} onChange={(e) => setDiv(e.target.value)} /></span>
        <button type="button" style={S.btn} onClick={save}>{editing == null ? 'Aggiungi' : 'Salva'}</button>
        {editing != null && <button type="button" style={S.btn} onClick={cancel}>Annulla</button>}
      </div>
      {msg && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}
