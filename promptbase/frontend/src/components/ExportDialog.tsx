import { useState } from 'react'
import { X, Download, Loader2 } from 'lucide-react'
import { getAccessToken } from '../api/client'

interface Props {
  messageId?: string
  conversationId?: string
  onClose: () => void
}

export default function ExportDialog({ messageId, conversationId, onClose }: Props) {
  const [format, setFormat] = useState<'docx' | 'pdf'>('docx')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleExport = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = messageId
        ? `/api/export/message/${messageId}?format=${format}`
        : `/api/export/conversation/${conversationId}?format=${format}`

      const token = getAccessToken()
      const res = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const filename = messageId
        ? `message.${format}`
        : `conversation.${format}`
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Export</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-gray-400 mb-4">
          {messageId ? 'Export this message' : 'Export full conversation'}
        </p>

        <div className="space-y-2 mb-4">
          {(['docx', 'pdf'] as const).map((fmt) => (
            <label key={fmt} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                value={fmt}
                checked={format === fmt}
                onChange={() => setFormat(fmt)}
                className="accent-indigo-500"
              />
              <span className="text-sm text-gray-300">
                {fmt === 'docx' ? 'Word Document (.docx)' : 'PDF (.pdf)'}
              </span>
            </label>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-3">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download
          </button>
        </div>
      </div>
    </div>
  )
}
