import { X, Loader2, CheckCircle2, FileText } from 'lucide-react'

interface AttachedDoc {
  id: string
  filename: string
  status: string
  isLibrary: boolean
}

interface Props {
  docs: AttachedDoc[]
  queuedFiles: File[]
  onRemove: (docId: string, isLibrary: boolean) => void
  onRemoveQueued: (index: number) => void
}

export default function AttachedDocs({ docs, queuedFiles, onRemove, onRemoveQueued }: Props) {
  if (docs.length === 0 && queuedFiles.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-1 pb-2">
      {queuedFiles.map((file, idx) => (
        <span
          key={`queued-${idx}`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{file.name}</span>
          <Loader2 size={10} className="animate-spin text-yellow-400 shrink-0" />
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
          className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-full text-xs text-gray-400"
        >
          <FileText size={10} className="shrink-0" />
          <span className="truncate max-w-[120px]">{doc.filename}</span>
          {doc.status === 'ready' ? (
            <CheckCircle2 size={10} className="text-green-400 shrink-0" />
          ) : (
            <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />
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
