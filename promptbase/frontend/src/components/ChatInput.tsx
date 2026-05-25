import { useState, useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useConversationDocs } from '../hooks/useDocumentStatus'
import TaskForm from './TaskForm'
import AttachButton from './AttachButton'
import AttachedDocs from './AttachedDocs'
import ModeChips from './ModeChips'
import type { TaskMode, Document } from '../types'

interface Props {
  onSend: (message: string, formData?: Record<string, string>, docIds?: string[]) => void
  onCancel: () => void
  isStreaming: boolean
  activeMode: TaskMode | null
  onModeChange: (mode: TaskMode | null) => void
  detectedMode: string | null
  teamId: string | null
  conversationId: string | null
  basicMode: boolean
}

export default function ChatInput({ onSend, onCancel, isStreaming, activeMode, onModeChange, detectedMode, teamId, conversationId, basicMode }: Props) {
  const [text, setText] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [attachedDocs, setAttachedDocs] = useState<Document[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const { data: conversationDocs = [] } = useConversationDocs(conversationId)

  useEffect(() => {
    if (conversationDocs.length > 0) {
      setAttachedDocs(conversationDocs)
    }
  }, [conversationDocs])

  useEffect(() => {
    setAttachedDocs([])
  }, [conversationId])

  // Poll processing docs until ready
  const attachedDocsRef = useRef(attachedDocs)
  attachedDocsRef.current = attachedDocs
  const pendingCount = attachedDocs.filter((d) => d.status === 'pending' || d.status === 'processing').length

  useEffect(() => {
    if (pendingCount === 0) return

    const interval = setInterval(async () => {
      const current = attachedDocsRef.current
      const updated = await Promise.all(
        current.map(async (d) => {
          if (d.status === 'ready' || d.status === 'failed') return d
          try {
            const base = teamId ? `/documents/${teamId}/${d.id}` : `/documents/personal/${d.id}`
            const res = await api.get(base)
            return res.data as Document
          } catch {
            return d
          }
        })
      )
      setAttachedDocs(updated)
    }, 2000)

    return () => clearInterval(interval)
  }, [pendingCount, teamId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message && !activeMode?.form_schema) return

    const docIds = attachedDocs.filter((d) => d.status === 'ready').map((d) => d.id)
    onSend(message, Object.keys(formData).length > 0 ? formData : undefined, docIds.length > 0 ? docIds : undefined)
    setText('')
    setFormData({})
    setAttachedDocs([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
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
      const deleteBase = teamId ? `/documents/${teamId}/${docId}` : `/documents/personal/${docId}`
      await api.delete(deleteBase)
      queryClient.invalidateQueries({ queryKey: ['conversation-docs', conversationId] })
    }
  }

  const docPills = attachedDocs.map((d) => ({
    id: d.id,
    filename: d.filename,
    status: d.status,
    progress: d.progress ?? 0,
    isLibrary: !d.conversation_id,
  }))

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
      {activeMode?.form_schema && (
        <div className="mb-3">
          <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
        </div>
      )}
      {/* Mode chips */}
      {teamId && !basicMode && (
        <ModeChips
          teamId={teamId}
          selectedMode={activeMode}
          detectedMode={detectedMode}
          onModeChange={onModeChange}
        />
      )}
      <AttachedDocs
        docs={docPills}
        queuedFiles={[]}
        onRemove={handleRemoveDoc}
        onRemoveQueued={() => {}}
      />
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <AttachButton
          teamId={teamId}
          conversationId={conversationId}
          onFileQueued={() => {}}
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
          className="flex-1 resize-none bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-48 overflow-y-auto"
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
      <p className="text-xs text-gray-400 dark:text-gray-600 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
    </div>
  )
}
