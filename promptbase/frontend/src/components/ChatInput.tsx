import { useState, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useConversationDocs } from '../hooks/useDocumentStatus'
import TaskForm from './TaskForm'
import AttachButton from './AttachButton'
import AttachedDocs from './AttachedDocs'
import type { TaskMode, Document } from '../types'

interface Props {
  onSend: (message: string, formData?: Record<string, string>, docIds?: string[]) => void
  onCancel: () => void
  isStreaming: boolean
  activeMode: TaskMode | null
  teamId: string
  conversationId: string | null
  onUploadQueued: (files: File[]) => void
}

export default function ChatInput({ onSend, onCancel, isStreaming, activeMode, teamId, conversationId, onUploadQueued }: Props) {
  const [text, setText] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [queuedFiles, setQueuedFiles] = useState<File[]>([])
  const [attachedDocs, setAttachedDocs] = useState<Document[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { data: conversationDocs = [] } = useConversationDocs(conversationId)

  // Sync attached docs from server
  useEffect(() => {
    if (conversationDocs.length > 0) {
      setAttachedDocs(conversationDocs)
    }
  }, [conversationDocs])

  // Clear queued files when conversation changes
  useEffect(() => {
    setQueuedFiles([])
    setAttachedDocs([])
  }, [conversationId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message && !activeMode?.form_schema) return

    const docIds = attachedDocs.filter((d) => d.status === 'ready').map((d) => d.id)

    // If there are queued files, pass them up for upload after conversation creation
    if (queuedFiles.length > 0) {
      onUploadQueued(queuedFiles)
      setQueuedFiles([])
    }

    onSend(message, Object.keys(formData).length > 0 ? formData : undefined, docIds.length > 0 ? docIds : undefined)
    setText('')
    setFormData({})
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleFileQueued = (file: File) => {
    setQueuedFiles((prev) => [...prev, file])
  }

  const handleDocAttached = (doc: Document) => {
    setAttachedDocs((prev) => {
      if (prev.find((d) => d.id === doc.id)) return prev
      return [...prev, doc]
    })
  }

  const handleRemoveDoc = async (docId: string, isLibrary: boolean) => {
    setAttachedDocs((prev) => prev.filter((d) => d.id !== docId))
    if (isLibrary && conversationId) {
      await api.delete(`/documents/conversation/${conversationId}/detach/${docId}`)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    } else if (!isLibrary && conversationId) {
      await api.delete(`/documents/${teamId}/${docId}`)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    }
  }

  const handleRemoveQueued = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const docPills = attachedDocs.map((d) => ({
    id: d.id,
    filename: d.filename,
    status: d.status,
    progress: d.progress ?? 0,
    isLibrary: !d.conversation_id,
  }))

  return (
    <div className="border-t border-gray-800 bg-gray-950 p-4">
      {activeMode?.form_schema && (
        <div className="mb-3">
          <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
        </div>
      )}
      <AttachedDocs
        docs={docPills}
        queuedFiles={queuedFiles}
        onRemove={handleRemoveDoc}
        onRemoveQueued={handleRemoveQueued}
      />
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <AttachButton
          teamId={teamId}
          conversationId={conversationId}
          onFileQueued={handleFileQueued}
          onDocAttached={handleDocAttached}
          disabled={isStreaming}
        />
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={isStreaming}
          placeholder={activeMode ? `${activeMode.name} — describe your request…` : 'Message…'}
          className="flex-1 resize-none bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-48 overflow-y-auto"
          style={{ fieldSizing: 'content' } as any}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex-shrink-0 w-10 h-10 bg-red-700 hover:bg-red-600 rounded-xl flex items-center justify-center transition-colors"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() && !activeMode?.form_schema}
            className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
          >
            <Send size={16} />
          </button>
        )}
      </form>
      <p className="text-xs text-gray-600 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
    </div>
  )
}
