import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api } from '../api/client'
import type { TaskMode, Team } from '../types'

interface Props {
  teamId: string
  selectedMode: TaskMode | null
  detectedMode: string | null
  onModeChange: (mode: TaskMode | null) => void
}

export default function ModeChips({ teamId, selectedMode, detectedMode, onModeChange }: Props) {
  const { data: team } = useQuery<Team>({
    queryKey: ['team', teamId],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      return res.data.find((t: Team) => t.id === teamId) ?? null
    },
  })

  const { data: modes = [] } = useQuery<TaskMode[]>({
    queryKey: ['modes', team?.pack_id],
    enabled: !!team?.pack_id,
    queryFn: async () => {
      const res = await api.get(`/admin/packs/${team!.pack_id}/modes`)
      return res.data
    },
  })

  if (modes.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-2">
      <Sparkles size={12} className="text-gray-400 shrink-0" />
      {modes.map((mode) => {
        const isSelected = selectedMode?.id === mode.id
        const isDetected = !selectedMode && detectedMode === mode.name
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onModeChange(isSelected ? null : mode)}
            title={mode.prompt_text?.slice(0, 100) || mode.name}
            className={`px-2 py-0.5 text-xs rounded-full border transition-all ${
              isSelected
                ? 'bg-indigo-600 text-white border-indigo-600'
                : isDetected
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            {mode.name}
          </button>
        )
      })}
    </div>
  )
}
