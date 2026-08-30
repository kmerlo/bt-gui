import { useEffect, useState } from 'react'
import { formatDate, parseDateIT } from '../../utils/format'

type Props = {
  value: string
  onChange: (iso: string) => void
  style?: React.CSSProperties
  placeholder?: string
}

export default function DateInputIT({ value, onChange, style, placeholder = 'gg/mm/aaaa' }: Props) {
  const [draft, setDraft] = useState(() => formatDate(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => { setDraft(formatDate(value)); setInvalid(false) }, [value])

  const handleChange = (v: string) => {
    setDraft(v)
    const t = v.trim()
    if (!t) { onChange(''); setInvalid(false); return }
    const iso = parseDateIT(t)
    if (iso) { onChange(iso); setInvalid(false) }
    else {
      // partial typing (e.g. "3", "31/1") -> don't mark invalid yet
      const partial = /^[\d/.\-]*$/.test(t) && t.length < 10
      setInvalid(!partial && t.length >= 8)
    }
  }

  const handleBlur = () => {
    const t = draft.trim()
    if (!t) { onChange(''); setDraft(''); setInvalid(false); return }
    const iso = parseDateIT(t)
    if (iso) { onChange(iso); setDraft(formatDate(iso)); setInvalid(false) }
    else setInvalid(true)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={draft}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      style={invalid ? { ...style, borderColor: '#f85149' } : style}
    />
  )
}
