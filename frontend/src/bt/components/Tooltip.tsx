import { useState } from 'react'

export default function Tooltip({ trigger, content, fullWidth }: { trigger: React.ReactNode; content: string | React.ReactNode; fullWidth?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!content) return <>{trigger}</>
  return (
    <span
      style={{
        position: 'relative',
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {trigger}
      {open && (
        <span
          style={{
            position: 'absolute',
            zIndex: 1000,
            ...(fullWidth ? { right: 4, width: 'calc(100% - 8px)', bottom: 'calc(100% + 4px)' } : { left: 0, top: '100%', marginTop: 4, maxWidth: 240 }),
            background: '#1c2128',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            color: '#c9d1d9',
            lineHeight: 1.5,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
