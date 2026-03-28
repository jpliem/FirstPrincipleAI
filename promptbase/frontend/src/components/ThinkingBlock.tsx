import { useState, useEffect, useRef } from 'react'
import { ChevronRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  isStreaming: boolean
  hasTextStarted: boolean
}

export default function ThinkingBlock({ content, isStreaming, hasTextStarted }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Auto-collapse when text starts arriving
  useEffect(() => {
    if (hasTextStarted && isStreaming) {
      setCollapsed(true)
    }
  }, [hasTextStarted, isStreaming])

  // For history (not streaming), start collapsed
  useEffect(() => {
    if (!isStreaming && content) {
      setCollapsed(true)
    }
  }, [])

  if (!content) return null

  return (
    <div className="mb-3">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 transition-colors py-1"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
        />
        <span>Thinking{isStreaming && !hasTextStarted ? '...' : ''}</span>
        {collapsed && (
          <span className="text-gray-600 ml-1 truncate max-w-xs">
            {content.slice(0, 60)}{content.length > 60 ? '...' : ''}
          </span>
        )}
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          collapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
        }`}
      >
        <div
          ref={contentRef}
          className="pl-4 border-l border-gray-700 mt-1 text-sm text-gray-500 italic prose prose-invert prose-sm max-w-none overflow-y-auto max-h-[500px]"
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          {isStreaming && !hasTextStarted && (
            <span className="inline-block w-1.5 h-3 bg-gray-500 animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  )
}
