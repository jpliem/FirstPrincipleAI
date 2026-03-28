import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { api } from '../api/client'
import type { TaskMode, Team } from '../types'

interface Props {
  teamId: string
  onModeChange?: (mode: TaskMode | null) => void
}

export default function ModeSelector({ teamId, onModeChange }: Props) {
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
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1">
        Task Mode
      </label>
      <select
        onChange={(e) => {
          const mode = modes.find((m) => m.id === e.target.value) ?? null
          onModeChange?.(mode)
        }}
        defaultValue=""
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="">Auto-detect from message</option>
        {modes.map((mode) => (
          <option key={mode.id} value={mode.id}>{mode.name}</option>
        ))}
      </select>
      <p className="text-xs text-gray-600 mt-1 px-1 flex items-center gap-1">
        <Sparkles size={10} /> Auto matches: analysis, design, implementation...
      </p>
    </div>
  )
}
