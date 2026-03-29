import { useState } from 'react'
import { Check, X, ChevronRight } from 'lucide-react'

interface ProposedModule {
  title: string
  layer: string
  tags: string[]
  priority: number
  sort_order: number
  content: string
}

interface Props {
  modules: ProposedModule[]
  packName: string
  onPackNameChange: (name: string) => void
  onApply: (acceptedIndices: number[]) => void
  applying: boolean
}

const LAYER_COLOR: Record<string, string> = {
  core: 'text-blue-400 bg-blue-900/30 dark:bg-blue-900/30',
  always: 'text-purple-400 bg-purple-900/30 dark:bg-purple-900/30',
  domain: 'text-green-400 bg-green-900/30 dark:bg-green-900/30',
}

export default function ModuleReview({ modules, packName, onPackNameChange, onApply, applying }: Props) {
  const [accepted, setAccepted] = useState<Set<number>>(() => new Set(modules.map((_, i) => i)))
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const toggleModule = (idx: number) => {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Review Generated Modules</h3>
        <input
          type="text"
          value={packName}
          onChange={(e) => onPackNameChange(e.target.value)}
          placeholder="Pack name"
          className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          {accepted.size} of {modules.length} modules selected
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {modules.map((mod, idx) => {
          const isAccepted = accepted.has(idx)
          const isExpanded = expandedIdx === idx
          return (
            <div key={idx} className={`rounded-lg border transition-colors ${
              isAccepted
                ? 'border-green-800/50 bg-green-900/10 dark:bg-green-900/10'
                : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 opacity-60'
            }`}>
              <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleModule(idx) }}
                  className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors ${
                    isAccepted ? 'bg-green-600 text-white' : 'bg-gray-300 dark:bg-gray-700 text-gray-500'
                  }`}
                >
                  {isAccepted ? <Check size={12} /> : <X size={12} />}
                </button>
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${LAYER_COLOR[mod.layer] ?? ''}`}>
                  {mod.layer}
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{mod.title}</span>
                <ChevronRight size={14} className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
              </div>
              {isExpanded && (
                <div className="px-3 pb-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2 mt-2 mb-2 flex-wrap">
                    {mod.tags.map((tag) => (
                      <span key={tag} className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded px-1.5 py-0.5">{tag}</span>
                    ))}
                  </div>
                  <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto font-mono bg-gray-50 dark:bg-gray-900 rounded p-2">
                    {mod.content}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={() => onApply(Array.from(accepted))}
          disabled={accepted.size === 0 || applying || !packName.trim()}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
        >
          {applying ? 'Creating Pack...' : `Create Pack with ${accepted.size} Modules`}
        </button>
      </div>
    </div>
  )
}
