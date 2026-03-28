import { useState, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import TaskForm from './TaskForm'
import type { TaskMode } from '../types'

interface Props {
  onSend: (message: string, formData?: Record<string, string>) => void
  onCancel: () => void
  isStreaming: boolean
  activeMode: TaskMode | null
}

export default function ChatInput({ onSend, onCancel, isStreaming, activeMode }: Props) {
  const [text, setText] = useState('')
  const [formData, setFormData] = useState<Record<string, string>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const message = text.trim()
    if (!message && !activeMode?.form_schema) return
    onSend(message, Object.keys(formData).length > 0 ? formData : undefined)
    setText('')
    setFormData({})
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950 p-4">
      {activeMode?.form_schema && (
        <div className="mb-3">
          <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
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
