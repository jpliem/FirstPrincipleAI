import { useState, useRef } from 'react'
import { Paperclip, Upload, Library, Loader2, FileText, FolderUp, CheckCircle2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useLibraryDocs } from '../hooks/useDocumentStatus'
import type { Document } from '../types'

interface Props {
  teamId: string
  conversationId: string | null
  onFileQueued: (file: File) => void
  onDocAttached: (doc: Document) => void
  disabled: boolean
}

export default function AttachButton({ teamId, conversationId, onFileQueued, onDocAttached, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<'conversation' | 'library'>('conversation')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const { data: libraryDocs = [] } = useLibraryDocs(teamId)

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return

    if (uploadTarget === 'library') {
      setOpen(false)
      setUploading(true)
      try {
        for (const file of Array.from(files)) {
          const form = new FormData()
          form.append('file', file)
          await api.post(`/documents/${teamId}/upload`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        }
        queryClient.invalidateQueries({ queryKey: ['library-docs', teamId] })
        // Auto-open library view to show the upload
        setOpen(true)
        setShowLibrary(true)
      } catch (err) {
        console.error('Upload failed:', err)
      } finally {
        setUploading(false)
        setUploadTarget('conversation')
      }
      return
    }

    setOpen(false)

    if (!conversationId) {
      for (const file of Array.from(files)) {
        onFileQueued(file)
      }
      return
    }

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await api.post(
          `/documents/${teamId}/upload?conversation_id=${conversationId}`,
          form,
          { headers: { 'Content-Type': 'multipart/form-data' } }
        )
        onDocAttached(res.data)
      }
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setUploading(false)
    }
  }

  const handleAttachFromLibrary = async (doc: Document) => {
    if (!conversationId || doc.status !== 'ready') return
    setOpen(false)
    setShowLibrary(false)
    try {
      await api.post(`/documents/conversation/${conversationId}/attach`, {
        document_id: doc.id,
      })
      onDocAttached(doc)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } catch (err) {
      console.error('Attach failed:', err)
    }
  }

  const STATUS_ICON: Record<string, React.ReactNode> = {
    pending: <Loader2 size={12} className="animate-spin text-yellow-400 shrink-0" />,
    processing: <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />,
    ready: <CheckCircle2 size={12} className="text-green-400 shrink-0" />,
  }

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.csv"
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />

      <button
        type="button"
        onClick={() => { setOpen(!open); setShowLibrary(false) }}
        disabled={disabled || uploading}
        className="flex-shrink-0 w-10 h-10 text-gray-500 hover:text-gray-300 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
        title="Attach document"
      >
        {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
          {!showLibrary ? (
            <>
              <button
                onClick={() => { setUploadTarget('conversation'); fileInputRef.current?.click(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <Upload size={14} />
                Upload to chat
              </button>
              <button
                onClick={() => { setUploadTarget('library'); fileInputRef.current?.click() }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
              >
                <FolderUp size={14} />
                Upload to library
              </button>
              <button
                onClick={() => setShowLibrary(true)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
              >
                <Library size={14} />
                From library {libraryDocs.length > 0 && <span className="text-gray-600 text-xs">({libraryDocs.length})</span>}
              </button>
            </>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
                <button
                  onClick={() => setShowLibrary(false)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  ← Back
                </button>
                <span className="text-xs text-gray-600">Team Library</span>
              </div>
              {libraryDocs.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-500 text-center">No library documents yet.<br />Upload one with "Upload to library".</p>
              ) : (
                libraryDocs.map((doc) => {
                  const isReady = doc.status === 'ready'
                  const canAttach = isReady && !!conversationId
                  return (
                    <button
                      key={doc.id}
                      onClick={() => canAttach && handleAttachFromLibrary(doc)}
                      disabled={!canAttach}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                        canAttach
                          ? 'text-gray-300 hover:bg-gray-700 cursor-pointer'
                          : 'text-gray-500 cursor-default'
                      }`}
                      title={!conversationId ? 'Send a message first to attach docs' : !isReady ? 'Still processing...' : doc.filename}
                    >
                      <FileText size={12} className="text-gray-500 shrink-0" />
                      <span className="truncate flex-1 text-left">{doc.filename}</span>
                      {STATUS_ICON[doc.status]}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
