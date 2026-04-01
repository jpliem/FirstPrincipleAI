import { Bot } from 'lucide-react'

export default function TypingIndicator() {
  return (
    <div className="flex gap-3 px-4 py-4 bg-gray-100 dark:bg-gray-900/40">
      <div className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-300 dark:bg-gray-700">
        <Bot size={14} />
      </div>
      <div className="flex items-center gap-1 pt-2">
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0s' }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0.2s' }} />
        <span className="typing-dot w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500" style={{ animationDelay: '0.4s' }} />
      </div>
    </div>
  )
}
