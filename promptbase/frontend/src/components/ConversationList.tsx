import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Conversation } from '../types'

interface Props {
  teamId: string
  activeId: string | null
  onSelect: (conv: Conversation) => void
  onDeleted: (convId: string) => void
}

export default function ConversationList({ teamId, activeId, onSelect, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['conversations', teamId],
    queryFn: async () => {
      const res = await api.get(`/chat/conversations/${teamId}`)
      return res.data.conversations as Conversation[]
    },
    refetchInterval: 10_000,
  })

  const handleDelete = async (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation()
    await api.delete(`/chat/conversations/${teamId}/${conv.id}`)
    queryClient.invalidateQueries({ queryKey: ['conversations', teamId] })
    if (conv.id === activeId) {
      onDeleted(conv.id)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-0.5">
      <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        History
      </p>
      {(data ?? []).map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv)}
          className={`group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
            conv.id === activeId
              ? 'bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
          }`}
        >
          <MessageCircle size={14} className="shrink-0 text-gray-500" />
          <span className="truncate flex-1">{conv.title || 'Untitled'}</span>
          {conv.mode && (
            <span className="shrink-0 text-xs text-gray-500 bg-gray-200 dark:bg-gray-800 rounded px-1.5 py-0.5 group-hover:hidden">
              {conv.mode}
            </span>
          )}
          <button
            onClick={(e) => handleDelete(e, conv)}
            className="hidden group-hover:block shrink-0 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete conversation"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {(data ?? []).length === 0 && (
        <p className="px-3 py-2 text-sm text-gray-500">No conversations yet</p>
      )}
    </div>
  )
}
