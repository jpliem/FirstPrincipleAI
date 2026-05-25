import { useRef, useCallback } from 'react'
import { getAccessToken } from '../api/client'

export interface ChatMeta {
  conversation_id: string
  provider: string
  model: string
  mode_detected: string | null
  modules_loaded: string[]
  modules_by_layer: Record<string, string[]>
  core_mode: string | null
  domains_matched: string[]
  prompt_tokens: number
  context_limit: number
  budget_remaining: number
  trimmed: string[]
}

interface SSEOptions {
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onMeta: (meta: ChatMeta) => void
  onDone: () => void
  onError: (err: string) => void
  onTitleGenerated?: (title: string) => void
}

export function useSSE() {
  const abortRef = useRef<AbortController | null>(null)

  const startStream = useCallback(
    async (
      body: {
        message: string
        team_id: string
        conversation_id?: string | null
        document_ids?: string[]
        mode?: string | null
        basic_mode?: boolean
      },
      opts: SSEOptions
    ) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const token = getAccessToken()
      try {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok) {
          opts.onError(`Request failed: ${res.status}`)
          return
        }

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let metaReceived = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data.startsWith('[DONE]')) {
              if (data.length > 6) {
                try {
                  const donePayload = JSON.parse(data.slice(6))
                  if (donePayload.new_title) {
                    opts.onTitleGenerated?.(donePayload.new_title)
                  }
                } catch {}
              }
              opts.onDone()
              return
            }
            if (data.startsWith('[ERROR]')) { opts.onError(data.slice(8)); opts.onDone(); return }

            // First event is metadata JSON
            if (!metaReceived) {
              try {
                const parsed = JSON.parse(data)
                if (parsed.conversation_id) {
                  metaReceived = true
                  opts.onMeta(parsed as ChatMeta)
                  continue
                }
              } catch {}
            }

            // Typed events: "thinking:content" or "text:content"
            if (data.startsWith('thinking:')) {
              opts.onThinking(data.slice(9).replace(/\\n/g, '\n'))
            } else if (data.startsWith('text:')) {
              opts.onToken(data.slice(5).replace(/\\n/g, '\n'))
            } else {
              // Backwards compatibility: unprefixed = text
              opts.onToken(data.replace(/\\n/g, '\n'))
            }
          }
        }
        opts.onDone()
      } catch (err: any) {
        if (err.name !== 'AbortError') opts.onError(err.message)
      }
    },
    []
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { startStream, cancel }
}
