import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useSSE, type ChatMeta } from '../hooks/useSSE'
import type { Team, Conversation, Message, TaskMode } from '../types'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import ExportButton from './ExportButton'

interface Props {
  team: Team
  conversation: Conversation | null
  onConversationCreated: (conv: Conversation) => void
  activeMode: TaskMode | null
  selectedDocIds: string[]
}

export default function ChatMain({ team, conversation, onConversationCreated, activeMode, selectedDocIds }: Props) {
  const queryClient = useQueryClient()
  const { startStream, cancel } = useSSE()
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(conversation?.id ?? null)
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setConversationId(conversation?.id ?? null)
  }, [conversation])

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['messages', team.id, conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await api.get(`/chat/conversations/${team.id}/${conversationId}/messages`)
      return res.data
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  const handleSend = async (text: string, formData?: Record<string, string>) => {
    let message = text
    if (formData && Object.keys(formData).length > 0) {
      const fields = Object.entries(formData)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n')
      message = text ? `${text}\n\n${fields}` : fields
    }

    setIsStreaming(true)
    setStreamBuffer('')
    setLastMeta(null)

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: message,
      token_count: 0,
      created_at: new Date().toISOString(),
    }
    queryClient.setQueryData<Message[]>(
      ['messages', team.id, conversationId],
      (old) => [...(old ?? []), tempUserMsg]
    )

    await startStream(
      {
        message,
        team_id: team.id,
        conversation_id: conversationId,
        document_ids: selectedDocIds,
        mode: activeMode?.name ?? null,
      },
      {
        onMeta: (meta) => {
          setLastMeta(meta)
          setConversationId(meta.conversation_id)
          queryClient.invalidateQueries({ queryKey: ['conversations', team.id] })
          if (!conversationId) {
            onConversationCreated({
              id: meta.conversation_id, title: message.slice(0, 60), mode: meta.mode_detected,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              message_count: 1,
            })
          }
        },
        onToken: (token) => {
          setStreamBuffer((prev) => prev + token)
        },
        onDone: () => {
          setIsStreaming(false)
          setStreamBuffer('')
          if (conversationId) {
            queryClient.invalidateQueries({ queryKey: ['messages', team.id, conversationId] })
          }
        },
        onError: (err) => {
          setIsStreaming(false)
          setStreamBuffer('')
          queryClient.setQueryData<Message[]>(
            ['messages', team.id, conversationId],
            (old) => [...(old ?? []), {
              id: `error-${Date.now()}`,
              role: 'assistant',
              content: `**Error:** ${err}`,
              token_count: 0,
              created_at: new Date().toISOString(),
            }]
          )
        },
      }
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-white">
            {conversation?.title ?? 'New Conversation'}
          </h1>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
            <span>{team.name}</span>
            {lastMeta?.mode_detected && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-indigo-400">{lastMeta.mode_detected} mode</span>
              </>
            )}
            {activeMode && !lastMeta?.mode_detected && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-indigo-400">{activeMode.name} mode</span>
              </>
            )}
            {lastMeta && (
              <>
                <span className="text-gray-700">·</span>
                <span className="text-gray-600">{lastMeta.modules_loaded} modules · {lastMeta.prompt_tokens} prompt tokens</span>
                {lastMeta.domains_matched.length > 0 && (
                  <>
                    <span className="text-gray-700">·</span>
                    <span className="text-emerald-600">{lastMeta.domains_matched.join(', ')}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {conversationId && (
          <ExportButton conversationId={conversationId} label="Export" />
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <p className="text-lg font-medium text-gray-400">Start a conversation</p>
            <p className="text-sm">Type a message below. Mode auto-detects from your message.</p>
            <p className="text-xs text-gray-600">analysis · solution design · implementation · tender response · architecture review · business process</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isStreaming && streamBuffer && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamBuffer,
              token_count: 0,
              created_at: new Date().toISOString(),
            }}
            isStreaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={cancel}
        isStreaming={isStreaming}
        activeMode={activeMode}
      />
    </div>
  )
}
