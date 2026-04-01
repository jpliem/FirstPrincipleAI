import { useRef, useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Loader2, CheckCircle2, XCircle, Trash2, FileText } from 'lucide-react'
import { api } from '../api/client'
import { useDocuments } from '../hooks/useDocumentStatus'
import type { Document } from '../types'

interface Props {
  teamId: string
  onDocumentsChange?: (docIds: string[]) => void
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Loader2 size={12} className="animate-spin text-yellow-400" />,
  processing: <Loader2 size={12} className="animate-spin text-blue-400" />,
  ready: <CheckCircle2 size={12} className="text-green-400" />,
  failed: <XCircle size={12} className="text-red-400" />,
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentUpload({ teamId, onDocumentsChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const queryClient = useQueryClient()
  const { data: documents = [] } = useDocuments(teamId)

  // Notify parent when selection changes
  useEffect(() => {
    onDocumentsChange?.(Array.from(selectedIds))
  }, [selectedIds, onDocumentsChange])

  // Auto-select newly ready documents
  useEffect(() => {
    const readyIds = documents.filter((d) => d.status === 'ready').map((d) => d.id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of readyIds) next.add(id)
      // Remove IDs that no longer exist
      for (const id of prev) {
        if (!documents.find((d) => d.id === id)) next.delete(id)
      }
      return next
    })
  }, [documents])

  const toggleDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/documents/${teamId}/upload`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }
      queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const deleteDocument = async (doc: Document) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(doc.id); return next })
    await api.delete(`/documents/${teamId}/${doc.id}`)
    queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
        Documents {selectedIds.size > 0 && <span className="text-indigo-400">({selectedIds.size} active)</span>}
      </p>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
          dragOver ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
        }`}
      >
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.csv" className="hidden" onChange={(e) => upload(e.target.files)} />
        {uploading ? (
          <Loader2 size={18} className="animate-spin text-indigo-400 mx-auto" />
        ) : (
          <>
            <Upload size={18} className="text-gray-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Drop files or click</p>
          </>
        )}
      </div>

      {documents.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              onClick={() => doc.status === 'ready' && toggleDoc(doc.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg group cursor-pointer transition-colors ${
                selectedIds.has(doc.id) ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-300 dark:border-indigo-700/50' : 'bg-gray-100 dark:bg-gray-800/50 hover:bg-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              {doc.status === 'ready' && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(doc.id)}
                  onChange={() => toggleDoc(doc.id)}
                  className="rounded border-gray-600 text-indigo-500 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <FileText size={12} className="text-gray-500 shrink-0" />
              <span className="flex-1 text-xs text-gray-700 dark:text-gray-300 truncate" title={doc.filename}>{doc.filename}</span>
              <span className="text-xs text-gray-600 shrink-0">{formatSize(doc.file_size)}</span>
              {STATUS_ICON[doc.status]}
              <button
                onClick={(e) => { e.stopPropagation(); deleteDocument(doc) }}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
