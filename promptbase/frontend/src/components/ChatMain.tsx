import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useSSE, type ChatMeta } from '../hooks/useSSE'
import type { Team, Conversation, Message, TaskMode } from '../types'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import ExportButton from './ExportButton'
import ProcessTimeline from './ProcessTimeline'
import TypingIndicator from './TypingIndicator'
import ErrorBanner from './ErrorBanner'

interface Props {
  team: Team | null
  conversation: Conversation | null
  onConversationCreated: (conv: Conversation) => void
  onConversationTitleChanged: (convId: string, title: string) => void
  activeMode: TaskMode | null
  onModeChange: (mode: TaskMode | null) => void
  basicMode: boolean
}

export default function ChatMain({ team, conversation, onConversationCreated, onConversationTitleChanged, activeMode, onModeChange, basicMode }: Props) {
  const queryClient = useQueryClient()
  const { startStream, cancel } = useSSE()
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [thinkingBuffer, setThinkingBuffer] = useState('')
  const [hasTextStarted, setHasTextStarted] = useState(false)
  const hasTextStartedRef = useRef(false)
  const [conversationId, setConversationId] = useState<string | null>(conversation?.id ?? null)
  const [lastMeta, setLastMeta] = useState<ChatMeta | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const pendingFilesRef = useRef<File[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Error handling state
  const [error, setError] = useState<string | null>(null)
  const lastSendArgsRef = useRef<{ text: string; formData?: Record<string, string>; docIds?: string[] } | null>(null)
  const streamConvIdRef = useRef<string | null>(null)

  const teamId = team?.id ?? null
  const queryNs = teamId ?? 'personal'
  const convQueryKey = ['conversations', queryNs]

  useEffect(() => {
    setConversationId(conversation?.id ?? null)
  }, [conversation])

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['messages', queryNs, conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const url = teamId
        ? `/chat/conversations/${teamId}/${conversationId}/messages`
        : `/chat/conversations/personal/${conversationId}/messages`
      const res = await api.get(url)
      return res.data
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer, thinkingBuffer])

  const handleSend = useCallback(async (text: string, formData?: Record<string, string>, docIds?: string[]) => {
    let message = text
    if (formData && Object.keys(formData).length > 0) {
      const fields = Object.entries(formData)
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n')
      message = text ? `${text}\n\n${fields}` : fields
    }

    // Store for retry
    lastSendArgsRef.current = { text, formData, docIds }
    setError(null)

    setIsStreaming(true)
    setStreamBuffer('')
    setThinkingBuffer('')
    setHasTextStarted(false)
    hasTextStartedRef.current = false
    setLastMeta(null)

    const tempUserMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: message,
      token_count: 0,
      created_at: new Date().toISOString(),
    }
    queryClient.setQueryData<Message[]>(
      ['messages', queryNs, conversationId],
      (old) => [...(old ?? []), tempUserMsg]
    )

    await startStream(
      {
        message,
        team_id: teamId,
        conversation_id: conversationId,
        document_ids: docIds ?? [],
        mode: activeMode?.name ?? null,
        basic_mode: basicMode,
      },
      {
        onMeta: (meta) => {
          setLastMeta(meta)
          setConversationId(meta.conversation_id)
          streamConvIdRef.current = meta.conversation_id
          queryClient.invalidateQueries({ queryKey: convQueryKey })
          if (!conversationId) {
            onConversationCreated({
              id: meta.conversation_id, title: message.slice(0, 60), mode: meta.mode_detected,
              is_pinned: false,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
              message_count: 1,
            })
          }
          // Upload queued files now that conversation exists
          const filesToUpload = pendingFilesRef.current
          if (filesToUpload.length > 0) {
            const cid = meta.conversation_id
            pendingFilesRef.current = []
            setPendingFiles([])
            const uploadBase = teamId ? `/documents/${teamId}/upload` : '/documents/personal/upload'
            Promise.all(
              filesToUpload.map((file) => {
                const form = new FormData()
                form.append('file', file)
                return api.post(`${uploadBase}?conversation_id=${cid}`, form, {
                  headers: { 'Content-Type': 'multipart/form-data' },
                })
              })
            ).then(() => {
              queryClient.invalidateQueries({ queryKey: ['conversation-docs', cid] })
            })
          }
        },
        onThinking: (token) => {
          setThinkingBuffer((prev) => prev + token)
        },
        onToken: (token) => {
          if (!hasTextStartedRef.current) {
            hasTextStartedRef.current = true
            setHasTextStarted(true)
          }
          setStreamBuffer((prev) => prev + token)
        },
        onTitleGenerated: (title) => {
          const cid = streamConvIdRef.current
          if (cid) {
            onConversationTitleChanged(cid, title)
            queryClient.invalidateQueries({ queryKey: convQueryKey })
          }
        },
        onDone: () => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          if (conversationId) {
            queryClient.invalidateQueries({ queryKey: ['messages', queryNs, conversationId] })
          }
        },
        onError: (err) => {
          setIsStreaming(false)
          setStreamBuffer('')
          setThinkingBuffer('')
          setHasTextStarted(false)
          hasTextStartedRef.current = false
          setError(err)
        },
      }
    )
  }, [teamId, queryNs, conversationId, convQueryKey, activeMode, basicMode, startStream, queryClient, onConversationCreated, onConversationTitleChanged])

  const handleRetry = useCallback(() => {
    if (lastSendArgsRef.current) {
      const { text, formData, docIds } = lastSendArgsRef.current
      setError(null)
      handleSend(text, formData, docIds)
    }
  }, [handleSend])

  const showTypingIndicator = isStreaming && !streamBuffer && !thinkingBuffer

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-gray-900 dark:text-white">
            {conversation?.title ?? 'New Conversation'}
          </h1>
          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
            <span>{team?.name ?? 'Personal Chat'}</span>
            {lastMeta?.model && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-emerald-600 dark:text-emerald-400">{lastMeta.model}</span>
              </>
            )}
            {lastMeta?.mode_detected && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-indigo-600 dark:text-indigo-400">{lastMeta.mode_detected} mode</span>
              </>
            )}
            {activeMode && !lastMeta?.mode_detected && (
              <>
                <span className="text-gray-400 dark:text-gray-700">&middot;</span>
                <span className="text-indigo-600 dark:text-indigo-400">{activeMode.name} mode</span>
              </>
            )}
          </div>
        </div>
        {conversationId && (
          <ExportButton conversationId={conversationId} label="Export" />
        )}
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto divide-y divide-gray-200/50 dark:divide-gray-800/50">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-500 gap-3">
            <p className="text-lg font-medium text-gray-500 dark:text-gray-400">
              {basicMode ? 'Basic Chat' : 'Start a conversation'}
            </p>
            <p className="text-sm">
              {basicMode
                ? 'Plain chat — no prompt pack, just you and the model.'
                : 'Type a message below. Mode auto-detects from your message.'}
            </p>
            {!basicMode && (
              <p className="text-xs text-gray-400 dark:text-gray-600">analysis · solution design · implementation · tender response · architecture review · business process</p>
            )}
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={msg.id}>
            <ChatMessage message={msg} />
            {!basicMode && msg.role === 'user' && idx === messages.length - 1 && lastMeta && !isStreaming && (
              <ProcessTimeline meta={lastMeta} />
            )}
          </div>
        ))}
        {!basicMode && isStreaming && lastMeta && (
          <ProcessTimeline meta={lastMeta} />
        )}
        {showTypingIndicator && <TypingIndicator />}
        {isStreaming && (streamBuffer || thinkingBuffer) && (
          <ChatMessage
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamBuffer,
              token_count: 0,
              created_at: new Date().toISOString(),
            }}
            isStreaming
            thinkingContent={thinkingBuffer}
            hasTextStarted={hasTextStarted}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error banner */}
      {error && (
        <ErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          onRetry={handleRetry}
        />
      )}

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        onCancel={cancel}
        isStreaming={isStreaming}
        activeMode={activeMode}
        onModeChange={onModeChange}
        detectedMode={lastMeta?.mode_detected ?? null}
        teamId={teamId}
        conversationId={conversationId}
        basicMode={basicMode}
        onUploadQueued={(files) => { pendingFilesRef.current = files; setPendingFiles(files) }}
      />
    </div>
  )
}
