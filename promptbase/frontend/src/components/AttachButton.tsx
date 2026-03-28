import { useState, useRef } from 'react'
import { Paperclip, Upload, Library, Loader2, FileText, FolderUp } from 'lucide-react'
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
    setOpen(false)

    if (uploadTarget === 'library') {
      // Upload to team library (no conversation_id)
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
      } catch (err) {
        console.error('Upload failed:', err)
      } finally {
        setUploading(false)
        setUploadTarget('conversation')
      }
      return
    }

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
    if (!conversationId) return
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
        <div className="absolute bottom-12 left-0 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-10 overflow-hidden">
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
                onClick={() => { setUploadTarget('library'); fileInputRef.current?.click(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
              >
                <FolderUp size={14} />
                Upload to library
              </button>
              {conversationId && (
                <button
                  onClick={() => setShowLibrary(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 transition-colors border-t border-gray-700"
                >
                  <Library size={14} />
                  From library
                </button>
              )}
            </>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              <button
                onClick={() => setShowLibrary(false)}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-700 border-b border-gray-700"
              >
                ← Back
              </button>
              {libraryDocs.length === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">No library documents</p>
              ) : (
                libraryDocs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleAttachFromLibrary(doc)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors"
                  >
                    <FileText size={12} className="text-gray-500 shrink-0" />
                    <span className="truncate">{doc.filename}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
