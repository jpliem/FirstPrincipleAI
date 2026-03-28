import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, Loader2, CheckCircle2, XCircle, Trash2, FileText } from 'lucide-react'
import { api } from '../api/client'
import { useDocuments } from '../hooks/useDocumentStatus'
import type { Document } from '../types'

interface Props {
  teamId: string
}

const STATUS_ICON = {
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

export default function DocumentUpload({ teamId }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const queryClient = useQueryClient()
  const { data: documents = [] } = useDocuments(teamId)

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
    await api.delete(`/documents/${teamId}/${doc.id}`)
    queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Documents</p>

      {/* Drop zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
        className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-indigo-500 bg-indigo-500/10'
            : 'border-gray-700 hover:border-gray-600'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.csv"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        {uploading ? (
          <Loader2 size={18} className="animate-spin text-indigo-400 mx-auto" />
        ) : (
          <>
            <Upload size={18} className="text-gray-500 mx-auto mb-1" />
            <p className="text-xs text-gray-500">Drop files or click to upload</p>
            <p className="text-xs text-gray-600 mt-0.5">PDF, DOCX, TXT, CSV</p>
          </>
        )}
      </div>

      {/* Document list */}
      {documents.length > 0 && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/50 group"
            >
              <FileText size={12} className="text-gray-500 shrink-0" />
              <span className="flex-1 text-xs text-gray-300 truncate" title={doc.filename}>
                {doc.filename}
              </span>
              <span className="text-xs text-gray-600 shrink-0">{formatSize(doc.file_size)}</span>
              {STATUS_ICON[doc.status]}
              <button
                onClick={() => deleteDocument(doc)}
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
