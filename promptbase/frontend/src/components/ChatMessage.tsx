import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot } from 'lucide-react'
import type { Message } from '../types'
import ExportButton from './ExportButton'
import ThinkingBlock from './ThinkingBlock'

interface Props {
  message: Message
  isStreaming?: boolean
  thinkingContent?: string
  hasTextStarted?: boolean
}

export default function ChatMessage({ message, isStreaming = false, thinkingContent, hasTextStarted = true }: Props) {
  const isUser = message.role === 'user'
  const thinking = thinkingContent || message.thinking_content || ''

  return (
    <div className={`flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-gray-900/40'}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-indigo-600' : 'bg-gray-700'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {!isUser && thinking && (
          <ThinkingBlock
            content={thinking}
            isStreaming={isStreaming}
            hasTextStarted={hasTextStarted}
          />
        )}
        <div className="prose prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="border-collapse border border-gray-700 text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-700 bg-gray-800 px-3 py-1.5 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-700 px-3 py-1.5">{children}</td>
              ),
              code: ({ inline, children }: any) =>
                inline ? (
                  <code className="bg-gray-800 text-indigo-300 px-1 rounded text-xs">{children}</code>
                ) : (
                  <pre className="bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs">
                    <code>{children}</code>
                  </pre>
                ),
            }}
          >
            {message.content}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
          )}
        </div>
        {!isUser && !isStreaming && message.id && (
          <div className="flex items-center gap-2 pt-1">
            <span className="text-xs text-gray-600">{message.token_count} tokens</span>
            <ExportButton messageId={message.id} />
          </div>
        )}
      </div>
    </div>
  )
}
