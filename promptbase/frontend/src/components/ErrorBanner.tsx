import { useEffect } from 'react'
import { AlertCircle, X, RotateCcw } from 'lucide-react'

interface Props {
  message: string
  onDismiss: () => void
  onRetry: () => void
}

export default function ErrorBanner({ message, onDismiss, onRetry }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10_000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  return (
    <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      <button
        onClick={onRetry}
        className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-800/50 hover:bg-red-200 dark:hover:bg-red-800 rounded transition-colors"
      >
        <RotateCcw size={10} /> Retry
      </button>
      <button onClick={onDismiss} className="shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200">
        <X size={14} />
      </button>
    </div>
  )
}
