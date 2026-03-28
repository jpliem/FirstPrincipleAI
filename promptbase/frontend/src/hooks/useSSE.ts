import { useRef, useCallback } from 'react'
import { getAccessToken } from '../api/client'

interface SSEOptions {
  onToken: (token: string) => void
  onConversationId: (id: string) => void
  onDone: () => void
  onError: (err: string) => void
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
      },
      opts: SSEOptions
    ) => {
      // Cancel any existing stream
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

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') { opts.onDone(); return }
            if (data.startsWith('[ERROR]')) { opts.onError(data.slice(8)); opts.onDone(); return }
            // First event contains conversation_id JSON
            try {
              const parsed = JSON.parse(data)
              if (parsed.conversation_id) {
                opts.onConversationId(parsed.conversation_id)
                continue
              }
            } catch {}
            // Otherwise it's a token (newlines escaped as \\n)
            opts.onToken(data.replace(/\\n/g, '\n'))
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
