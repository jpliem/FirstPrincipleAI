import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Link as LinkIcon, Cpu, Check } from 'lucide-react'
import { api } from '../../api/client'
import type { Team, PromptPack } from '../../types'

interface Provider {
  id: string
  name: string
  has_api_key: boolean
  is_enabled: boolean
}

interface TeamLLMConfig {
  provider_name: string
  chat_model: string
  embedding_model: string
  max_tokens_per_request: number
  temperature: number
}

export default function AdminTeams() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [inviteToken, setInviteToken] = useState<{ teamId: string; token: string } | null>(null)
  const [editingLLM, setEditingLLM] = useState<string | null>(null)
  const [llmForm, setLlmForm] = useState<TeamLLMConfig>({
    provider_name: 'anthropic', chat_model: 'claude-sonnet-4-20250514',
    embedding_model: 'text-embedding-3-small', max_tokens_per_request: 4096, temperature: 0.7,
  })
  const [llmSaved, setLlmSaved] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
    queryKey: ['admin', 'teams'],
    queryFn: async () => (await api.get('/auth/teams')).data,
  })

  const { data: packs = [] } = useQuery<PromptPack[]>({
    queryKey: ['admin', 'packs'],
    queryFn: async () => (await api.get('/admin/packs')).data,
  })

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ['admin-providers'],
    queryFn: async () => (await api.get('/admin/providers')).data,
  })

  const createTeam = useMutation({
    mutationFn: (body: { name: string; description: string }) => api.post('/auth/teams', body),
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

  const saveLLMConfig = useMutation({
    mutationFn: ({ teamId, config }: { teamId: string; config: TeamLLMConfig }) =>
      api.put(`/admin/teams/${teamId}/llm-config`, config),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['team-llm-config', vars.teamId] })
      setEditingLLM(null)
      setLlmSaved(vars.teamId)
      setTimeout(() => setLlmSaved(null), 3000)
    },
  })

  const fetchModels = async (providerName: string) => {
    setLoadingModels(true)
    setModelError(null)
    setAvailableModels([])
    try {
      const res = await api.get(`/admin/providers/${providerName}/models`)
      if (res.data.error) {
        setModelError(res.data.error)
        setAvailableModels([])
      } else {
        setAvailableModels(res.data.models ?? [])
      }
    } catch (err: any) {
      setModelError(err.message)
    } finally {
      setLoadingModels(false)
    }
  }

  const startEditLLM = async (teamId: string) => {
    let provName = providers[0]?.name ?? 'ollama'
    try {
      const res = await api.get(`/admin/teams/${teamId}/llm-config`)
      if (res.data) {
        setLlmForm(res.data)
        provName = res.data.provider_name
      } else {
        setLlmForm({
          provider_name: provName,
          chat_model: '',
          embedding_model: 'text-embedding-3-small',
          max_tokens_per_request: 4096,
          temperature: 0.7,
        })
      }
    } catch {
      setLlmForm({
        provider_name: provName,
        chat_model: '',
        embedding_model: 'text-embedding-3-small',
        max_tokens_per_request: 4096,
        temperature: 0.7,
      })
    }
    setEditingLLM(teamId)
    fetchModels(provName)
  }

  const generateInvite = async (teamId: string) => {
    const res = await api.post(`/auth/teams/${teamId}/invite`, { expire_hours: 72 })
    setInviteToken({ teamId, token: res.data.invite_token })
  }

  const inviteUrl = inviteToken ? `${window.location.origin}/invite/${inviteToken.token}` : null
  const models = MODEL_OPTIONS[llmForm.provider_name] ?? []

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Teams</h1>
          <p className="text-sm text-gray-400 mt-1">Manage teams, prompt packs, and AI model configuration</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New Team
        </button>
      </div>

      {inviteUrl && (
        <div className="mb-6 p-4 bg-indigo-900/30 border border-indigo-700/50 rounded-xl">
          <p className="text-sm font-medium text-indigo-300 mb-2">Invite link generated (72h)</p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs text-indigo-200 bg-indigo-900/40 rounded px-3 py-2 break-all">{inviteUrl}</code>
            <button onClick={() => navigator.clipboard.writeText(inviteUrl)} className="px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-xs text-white shrink-0">Copy</button>
          </div>
          <button onClick={() => setInviteToken(null)} className="mt-2 text-xs text-gray-500 hover:text-gray-400">Dismiss</button>
        </div>
      )}

      {creating && (
        <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-white">New Team</h3>
          <input type="text" placeholder="Team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <input type="text" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <div className="flex gap-2">
            <button onClick={() => createTeam.mutate(form)} disabled={!form.name || createTeam.isPending} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium">
              {createTeam.isPending ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => setCreating(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm">Cancel</button>
          </div>
        </div>
      )}

      {teamsLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-500" /></div>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => (
            <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-white text-lg">{team.name}</h3>
                  {team.description && <p className="text-sm text-gray-400">{team.description}</p>}
                </div>
                <button onClick={() => generateInvite(team.id)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg">
                  <LinkIcon size={14} /> Invite
                </button>
              </div>

              {/* Prompt Pack assignment */}
              <div className="flex items-center gap-3 mb-3">
                <label className="text-xs text-gray-400 shrink-0 w-24">Prompt Pack</label>
                <select
                  value={team.pack_id ?? ''}
                  onChange={(e) => assignPack.mutate({ teamId: team.id, packId: e.target.value })}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">None</option>
                  {packs.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
                </select>
              </div>

              {/* LLM Config */}
              {llmSaved === team.id && (
                <div className="mb-3 p-2 bg-green-900/30 border border-green-800 rounded-lg text-green-400 text-xs flex items-center gap-1">
                  <Check size={12} /> LLM config saved
                </div>
              )}

              {editingLLM === team.id ? (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                  <h4 className="text-sm font-semibold text-white flex items-center gap-2"><Cpu size={14} /> AI Model Configuration</h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Provider</label>
                      <select
                        value={llmForm.provider_name}
                        onChange={(e) => {
                          const name = e.target.value
                          setLlmForm({ ...llmForm, provider_name: name, chat_model: '' })
                          fetchModels(name)
                        }}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                      >
                        {providers.length > 0 ? (
                          providers.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)
                        ) : (
                          <option value="">No providers configured</option>
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        Chat Model
                        {loadingModels && <Loader2 size={10} className="inline ml-1 animate-spin" />}
                      </label>
                      {availableModels.length > 0 ? (
                        <select
                          value={llmForm.chat_model}
                          onChange={(e) => setLlmForm({ ...llmForm, chat_model: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white"
                        >
                          <option value="">Select a model...</option>
                          {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={llmForm.chat_model}
                          onChange={(e) => setLlmForm({ ...llmForm, chat_model: e.target.value })}
                          placeholder={loadingModels ? 'Loading models...' : 'Type model name'}
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600"
                        />
                      )}
                      {modelError && <p className="text-xs text-red-400 mt-1">{modelError}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Embedding Model</label>
                      <input type="text" value={llmForm.embedding_model} onChange={(e) => setLlmForm({ ...llmForm, embedding_model: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Max Tokens</label>
                      <input type="number" value={llmForm.max_tokens_per_request} onChange={(e) => setLlmForm({ ...llmForm, max_tokens_per_request: Number(e.target.value) })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Temperature</label>
                      <input type="number" step="0.1" min="0" max="2" value={llmForm.temperature} onChange={(e) => setLlmForm({ ...llmForm, temperature: Number(e.target.value) })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white" />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => saveLLMConfig.mutate({ teamId: team.id, config: llmForm })} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium">
                      {saveLLMConfig.isPending ? 'Saving…' : 'Save Config'}
                    </button>
                    <button onClick={() => setEditingLLM(null)} className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => startEditLLM(team.id)}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors"
                >
                  <Cpu size={14} /> Configure AI Model
                </button>
              )}
            </div>
          ))}
          {teams.length === 0 && <p className="text-sm text-gray-500 text-center py-8">No teams yet</p>}
        </div>
      )}
    </div>
  )
}
