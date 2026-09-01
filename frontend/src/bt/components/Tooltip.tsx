import { useState } from 'react'

export default function Tooltip({ trigger, content }: { trigger: React.ReactNode; content: string | React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!content) return <>{trigger}</>
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {trigger}
      {open && (
        <span
          style={{
            position: 'absolute',
            zIndex: 1000,
            left: 0,
            top: '100%',
            marginTop: 4,
            background: '#1c2128',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: '#c9d1d9',
            lineHeight: 1.5,
            maxWidth: 280,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
