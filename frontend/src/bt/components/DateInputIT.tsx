import { useEffect, useState } from 'react'
import { parseDateIT } from '../../utils/format'

type Props = {
  value: string
  onChange: (iso: string) => void
  style?: React.CSSProperties
  placeholder?: string
  tooltip?: string
}

export default function DateInputIT({ value, onChange, style, placeholder = 'gg/mm/aaaa', tooltip }: Props) {
  const [draft, setDraft] = useState(() => value ?? '')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => { setDraft(value ?? ''); setInvalid(false) }, [value])

  const handleChange = (v: string) => {
    setDraft(v)
    const t = v.trim()
    if (!t) { onChange(''); setInvalid(false); return }
    const iso = parseDateIT(t)
    if (iso) { onChange(iso); setInvalid(false) }
    else {
      // partial typing (e.g. "3", "31/1") -> don't mark invalid yet
      const partial = /^[\d/.-]*$/.test(t) && t.length < 10
      setInvalid(!partial && t.length >= 8)
    }
  }

  const handleBlur = () => {
    const t = draft.trim()
    if (!t) { onChange(''); setDraft(''); setInvalid(false); return }
    const iso = parseDateIT(t)
    if (iso) { onChange(iso); setDraft(iso); setInvalid(false) }
    else setInvalid(true)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {tooltip && (
        <span
          style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, background: '#1f2328', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '2px 6px', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none', display: 'none' }}
          className="date-tooltip"
        >
          {tooltip}
        </span>
      )}
      <input
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onFocus={(e) => { const tip = e.currentTarget.parentElement?.querySelector<HTMLElement>('.date-tooltip'); if (tip) tip.style.display = 'block' }}
        onMouseLeave={(e) => { const tip = e.currentTarget.parentElement?.querySelector<HTMLElement>('.date-tooltip'); if (tip) tip.style.display = 'none' }}
        style={invalid ? { ...style, borderColor: '#f85149' } : style}
      />
    </span>
  )
}
