import { X, CheckCircle2, FileText } from 'lucide-react'

interface AttachedDoc {
  id: string
  filename: string
  status: string
  progress: number
  isLibrary: boolean
}

interface Props {
  docs: AttachedDoc[]
  queuedFiles: File[]
  onRemove: (docId: string, isLibrary: boolean) => void
  onRemoveQueued: (index: number) => void
}

function ProgressRing({ progress }: { progress: number }) {
  const size = 14
  const stroke = 2
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-gray-700" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="text-indigo-400 transition-all duration-300" />
    </svg>
  )
}

export default function AttachedDocs({ docs, queuedFiles, onRemove, onRemoveQueued }: Props) {
  if (docs.length === 0 && queuedFiles.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-2">
      {queuedFiles.map((file, idx) => (
        <span
          key={`queued-${idx}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{file.name}</span>
          <span className="text-yellow-500 dark:text-yellow-400 text-[10px]">queued</span>
          <button
            type="button"
            onClick={() => onRemoveQueued(idx)}
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {docs.map((doc) => (
        <span
          key={doc.id}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{doc.filename}</span>
          {doc.status === 'ready' ? (
            <CheckCircle2 size={10} className="text-green-400 shrink-0" />
          ) : doc.status === 'failed' ? (
            <span className="text-red-400 text-[10px]">failed</span>
          ) : (
            <>
              <ProgressRing progress={doc.progress} />
              <span className="text-indigo-400 text-[10px] tabular-nums">{doc.progress}%</span>
            </>
          )}
          <button
            type="button"
            onClick={() => onRemove(doc.id, doc.isLibrary)}
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
