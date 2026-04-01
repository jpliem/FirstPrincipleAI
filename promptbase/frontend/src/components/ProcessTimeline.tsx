import type { ChatMeta } from '../hooks/useSSE'

interface Props {
  meta: ChatMeta
}

export default function ProcessTimeline({ meta }: Props) {
  const coreMods = meta.modules_by_layer?.core?.length ?? 0
  const alwaysMods = meta.modules_by_layer?.always?.length ?? 0
  const domainMods = meta.modules_by_layer?.domain?.length ?? 0

  const moduleSummary = [
    coreMods > 0 && `${coreMods} core`,
    alwaysMods > 0 && `${alwaysMods} always`,
    domainMods > 0 && `${domainMods} domain`,
  ].filter(Boolean).join(' + ')

  const segments: string[] = []

  if (meta.mode_detected) {
    segments.push(`${meta.mode_detected} mode`)
  }

  if (meta.domains_matched.length > 0) {
    segments.push(meta.domains_matched.join(', '))
  }

  if (moduleSummary) {
    segments.push(moduleSummary)
  }

  if (meta.core_mode === 'condensed') {
    segments.push('condensed core')
  }

  segments.push(
    `${meta.prompt_tokens.toLocaleString()} / ${meta.context_limit.toLocaleString()} tokens`
  )

  segments.push(`${meta.model} (${meta.provider})`)

  if (meta.trimmed.length > 0) {
    segments.push(`trimmed: ${meta.trimmed.join(', ')}`)
  }

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-gray-500 dark:text-gray-600 border-l-2 border-gray-300 dark:border-gray-800 ml-4 my-1 flex-wrap">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-gray-400 dark:text-gray-700">&middot;</span>}
          <span className={
            seg.includes('mode') ? 'text-indigo-500' :
            seg.includes('trimmed') ? 'text-amber-500' :
            seg.includes('condensed') ? 'text-amber-500' :
            ''
          }>{seg}</span>
        </span>
      ))}
    </div>
  )
}
