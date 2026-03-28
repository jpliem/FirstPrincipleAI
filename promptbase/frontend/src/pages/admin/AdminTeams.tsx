import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Link as LinkIcon } from 'lucide-react'
import { api } from '../../api/client'
import type { Team, PromptPack } from '../../types'

export default function AdminTeams() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [inviteToken, setInviteToken] = useState<{ teamId: string; token: string } | null>(null)

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['admin', 'teams'],
    queryFn: async () => (await api.get('/auth/teams')).data,
  })

  const { data: packs = [] } = useQuery<PromptPack[]>({
    queryKey: ['admin', 'packs'],
    queryFn: async () => (await api.get('/admin/packs')).data,
  })

  const createTeam = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.post('/auth/teams', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'teams'] })
      setCreating(false)
      setForm({ name: '', description: '' })
    },
  })

  const assignPack = useMutation({
    mutationFn: ({ teamId, packId }: { teamId: string; packId: string }) =>
      api.put(`/admin/teams/${teamId}/pack`, null, { params: { pack_id: packId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'teams'] }),
  })

  const generateInvite = async (teamId: string) => {
    const res = await api.post(`/auth/teams/${teamId}/invite`, { expire_hours: 72 })
    setInviteToken({ teamId, token: res.data.invite_token })
  }

  const inviteUrl = inviteToken
    ? `${window.location.origin}/invite/${inviteToken.token}`
    : null

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Teams</h1>
          <p className="text-sm text-gray-400 mt-1">Manage teams and pack assignments</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New Team
        </button>
      </div>

      {inviteUrl && (
        <div className="mb-6 p-4 bg-indigo-900/30 border border-indigo-700/50 rounded-xl">
          <p className="text-sm font-medium text-indigo-300 mb-2">Invite link generated (72h)</p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs text-indigo-200 bg-indigo-900/40 rounded px-3 py-2 break-all">
              {inviteUrl}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(inviteUrl); }}
              className="px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-xs text-white transition-colors shrink-0"
            >
              Copy
            </button>
          </div>
          <button
            onClick={() => setInviteToken(null)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {creating && (
        <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-white">New Team</h3>
          <input
            type="text"
            placeholder="Team name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => createTeam.mutate(form)}
              disabled={!form.name || createTeam.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {createTeam.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {teamsLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-500" /></div>
      ) : (
        <div className="space-y-3">
          {teams.map((team) => (
            <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-white">{team.name}</h3>
                  {team.description && (
                    <p className="text-sm text-gray-400">{team.description}</p>
                  )}
                </div>
                <button
                  onClick={() => generateInvite(team.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <LinkIcon size={14} />
                  Invite Link
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-400 shrink-0">Prompt Pack:</label>
                <select
                  value={team.pack_id ?? ''}
                  onChange={(e) => assignPack.mutate({ teamId: team.id, packId: e.target.value })}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">None</option>
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {teams.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No teams yet</p>
          )}
        </div>
      )}
    </div>
  )
}
