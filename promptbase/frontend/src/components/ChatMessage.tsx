import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { User, Bot, Copy, Check, FileText } from 'lucide-react'
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
  const displayText = message.display_content ?? message.content
  const attachedFiles = message.attached_files ?? []
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`group/msg flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-gray-100 dark:bg-gray-900/40'}`}>
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'
      }`}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {isUser && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {attachedFiles.map((filename, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                <FileText size={10} />
                {filename}
              </span>
            ))}
          </div>
        )}
        {!isUser && thinking && (
          <ThinkingBlock
            content={thinking}
            isStreaming={isStreaming}
            hasTextStarted={hasTextStarted}
          />
        )}
        <div className="prose dark:prose-invert prose-sm max-w-none overflow-x-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="border-collapse border border-gray-300 dark:border-gray-700 text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-gray-300 dark:border-gray-700 bg-gray-200 dark:bg-gray-800 px-3 py-1.5 text-left font-semibold">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-gray-300 dark:border-gray-700 px-3 py-1.5">{children}</td>
              ),
              pre: ({ children }) => (
                <pre className="bg-gray-200 dark:bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs">
                  {children}
                </pre>
              ),
              code: ({ className, children }: any) => {
                const isBlock = /language-/.test(className || '')
                if (isBlock) {
                  return <code className={className}>{children}</code>
                }
                return (
                  <code className="bg-gray-200 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 px-1 rounded text-xs">
                    {children}
                  </code>
                )
              },
            }}
          >
            {displayText}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
          )}
        </div>
        {!isStreaming && message.id && !message.id.startsWith('temp-') && (
          <div className="flex items-center gap-2 pt-1">
            {!isUser && <span className="text-xs text-gray-400 dark:text-gray-600">{message.token_count} tokens</span>}
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover/msg:opacity-100 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
              title="Copy to clipboard"
            >
              {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            </button>
            {!isUser && <ExportButton messageId={message.id} />}
          </div>
        )}
      </div>
    </div>
  )
}
