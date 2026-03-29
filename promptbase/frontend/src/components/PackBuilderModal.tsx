import { useState, useRef, useEffect } from 'react'
import { X, Sparkles, Send, Loader2 } from 'lucide-react'
import { getAccessToken } from '../api/client'
import { api } from '../api/client'
import ChatMessage from './ChatMessage'
import ModuleReview from './ModuleReview'

interface Props {
  sourcePackId: string | null
  sourcePackName: string | null
  onClose: () => void
  onCreated: () => void
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export default function PackBuilderModal({ sourcePackId, sourcePackName, onClose, onCreated }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [phase, setPhase] = useState<'interview' | 'generating' | 'review'>('interview')
  const [generatedModules, setGeneratedModules] = useState<any[]>([])
  const [packName, setPackName] = useState(sourcePackName ? `${sourcePackName} (expanded)` : 'New Pack')
  const [applying, setApplying] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  // Start interview automatically
  const hasStarted = useRef(false)
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    sendToBuilder(
      '/api/admin/pack-builder/chat',
      [],
      sourcePackId
        ? 'I want to expand my existing prompt pack. What should I consider improving?'
        : 'I want to create a new prompt pack for my organization. Let\'s start.'
    )
  }, [])

  const sendToBuilder = async (url: string, prevMessages: ChatMsg[], userMessage: string) => {
    const allMessages = [...prevMessages, { role: 'user' as const, content: userMessage }]
    setMessages(allMessages)
    setInput('')
    setStreaming(true)
    setStreamBuffer('')

    const token = getAccessToken()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          source_pack_id: sourcePackId,
          pack_name: packName,
        }),
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data.trim() === '[DONE]') break
          if (data.trim().startsWith('[ERROR]')) {
            fullResponse += `\n\nError: ${data.trim().slice(8)}`
            break
          }
          const decoded = data.replace(/\\n/g, '\n')
          fullResponse += decoded
          setStreamBuffer(fullResponse)
        }
      }

      setMessages([...allMessages, { role: 'assistant', content: fullResponse }])
      setStreamBuffer('')

      if (url.includes('/generate')) {
        try {
          let jsonStr = fullResponse
          jsonStr = jsonStr.replace(/<think>[\s\S]*?<\/think>/g, '')
          if (jsonStr.includes('```json')) {
            jsonStr = jsonStr.split('```json')[1].split('```')[0]
          } else if (jsonStr.includes('```')) {
            jsonStr = jsonStr.split('```')[1].split('```')[0]
          }
          const idx = jsonStr.indexOf('{')
          if (idx >= 0) jsonStr = jsonStr.slice(idx)
          const lastIdx = jsonStr.lastIndexOf('}')
          if (lastIdx >= 0) jsonStr = jsonStr.slice(0, lastIdx + 1)

          const parsed = JSON.parse(jsonStr)
          setGeneratedModules(parsed.modules || [])
          if (parsed.pack_name) setPackName(parsed.pack_name)
          setPhase('review')
        } catch {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            content: 'Failed to parse the generated pack. Let me try again — click "Generate Pack" once more.',
          }])
          setPhase('interview')
        }
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
      }])
    } finally {
      setStreaming(false)
    }
  }

  const handleSend = () => {
    if (!input.trim() || streaming) return
    sendToBuilder('/api/admin/pack-builder/chat', messages, input.trim())
  }

  const handleGenerate = () => {
    setPhase('generating')
    sendToBuilder('/api/admin/pack-builder/generate', messages, 'Generate the pack now.')
  }

  const handleApply = async (acceptedIndices: number[]) => {
    setApplying(true)
    try {
      await api.post('/admin/pack-builder/apply', {
        pack_name: packName,
        source_pack_id: sourcePackId,
        accepted_indices: acceptedIndices,
        modules: generatedModules,
      })
      onCreated()
      onClose()
    } catch (err: any) {
      console.error('Apply failed:', err)
    } finally {
      setApplying(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-[900px] h-[700px] max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {sourcePackId ? 'Expand Pack' : 'Create Pack with AI'}
            </h2>
            {phase === 'generating' && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" /> Generating...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {phase === 'interview' && messages.length >= 2 && (
              <button
                onClick={handleGenerate}
                disabled={streaming}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
              >
                <Sparkles size={12} />
                Generate Pack
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-200 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        {phase === 'review' ? (
          <ModuleReview
            modules={generatedModules}
            packName={packName}
            onPackNameChange={setPackName}
            onApply={handleApply}
            applying={applying}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-gray-100 dark:divide-gray-800/50 min-w-0">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={{
                    id: `builder-${i}`,
                    role: msg.role,
                    content: msg.content,
                    token_count: 0,
                    created_at: new Date().toISOString(),
                  }}
                />
              ))}
              {streaming && streamBuffer && (
                <ChatMessage
                  message={{
                    id: 'builder-streaming',
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

            {phase === 'interview' && (
              <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={streaming}
                    placeholder="Answer the question..."
                    className="flex-1 resize-none bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-32 overflow-y-auto"
                    style={{ fieldSizing: 'content' } as any}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || streaming}
                    className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
                  >
                    <Send size={16} className="text-white" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
