import { useState } from 'react'
import { Download } from 'lucide-react'
import ExportDialog from './ExportDialog'

interface Props {
  messageId?: string
  conversationId?: string
  label?: string
}

export default function ExportButton({ messageId, conversationId, label }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Export"
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-800"
      >
        <Download size={12} />
        {label && <span>{label}</span>}
      </button>
      {open && (
        <ExportDialog
          messageId={messageId}
          conversationId={conversationId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
