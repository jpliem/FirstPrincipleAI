import { useQuery } from '@tanstack/react-query'
import { MessageCircle } from 'lucide-react'
import { api } from '../api/client'
import type { Conversation } from '../types'

interface Props {
  teamId: string
  activeId: string | null
  onSelect: (conv: Conversation) => void
}

export default function ConversationList({ teamId, activeId, onSelect }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['conversations', teamId],
    queryFn: async () => {
      const res = await api.get(`/chat/conversations/${teamId}`)
      return res.data.conversations as Conversation[]
    },
    refetchInterval: 10_000,
  })

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-gray-800 rounded-lg animate-pulse" />
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
        <button
          key={conv.id}
          onClick={() => onSelect(conv)}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
            conv.id === activeId
              ? 'bg-indigo-600/20 text-indigo-300'
              : 'text-gray-300 hover:bg-gray-800 hover:text-white'
          }`}
        >
          <MessageCircle size={14} className="shrink-0 text-gray-500" />
          <span className="truncate">{conv.title || 'Untitled'}</span>
          {conv.mode && (
            <span className="ml-auto shrink-0 text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
              {conv.mode}
            </span>
          )}
        </button>
      ))}
      {(data ?? []).length === 0 && (
        <p className="px-3 py-2 text-sm text-gray-500">No conversations yet</p>
      )}
    </div>
  )
}
