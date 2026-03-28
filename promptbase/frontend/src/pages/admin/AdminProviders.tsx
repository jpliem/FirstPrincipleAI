import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Plus, Trash2, Key, Check } from 'lucide-react'

interface Provider {
  id: string
  name: string
  base_url: string | null
  has_api_key: boolean
  is_enabled: boolean
}

const PROVIDER_OPTIONS = [
  { name: 'anthropic', label: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-20250514' },
  { name: 'openai', label: 'OpenAI (GPT)', defaultModel: 'gpt-4o' },
  { name: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4-20250514' },
  { name: 'ollama', label: 'Ollama (Local)', defaultModel: 'llama3' },
]

export default function AdminProviders() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: 'anthropic', base_url: '', api_key: '' })
  const [saved, setSaved] = useState<string | null>(null)

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ['admin-providers'],
    queryFn: async () => (await api.get('/admin/providers')).data,
  })

  const saveMutation = useMutation({
    mutationFn: async (body: { name: string; base_url?: string; api_key?: string }) => {
      return api.post('/admin/providers', body)
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
      setShowAdd(false)
      setForm({ name: 'anthropic', base_url: '', api_key: '' })
      setSaved(vars.name)
      setTimeout(() => setSaved(null), 3000)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/providers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-providers'] }),
  })

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">LLM Providers</h2>
          <p className="text-sm text-gray-400 mt-1">Configure API keys and endpoints for AI model providers</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg"
        >
          <Plus size={16} /> Add Provider
        </button>
      </div>

      {saved && (
        <div className="mb-4 p-3 bg-green-900/40 border border-green-700 rounded-lg text-green-300 text-sm flex items-center gap-2">
          <Check size={16} /> Provider "{saved}" saved successfully
        </div>
      )}

      {showAdd && (
        <div className="mb-6 bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Provider</label>
            <select
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.name} value={p.name}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              placeholder={form.name === 'ollama' ? 'Not required for Ollama' : 'sk-...'}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Base URL (optional)</label>
            <input
              type="text"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder={form.name === 'ollama' ? 'http://localhost:11434' : 'Leave blank for default'}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => saveMutation.mutate({
                name: form.name,
                api_key: form.api_key || undefined,
                base_url: form.base_url || undefined,
              })}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg"
            >
              Save Provider
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {providers.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <Key size={32} className="mx-auto mb-3 opacity-50" />
            <p>No providers configured yet.</p>
            <p className="text-sm mt-1">Add an API key to start using AI models.</p>
          </div>
        )}
        {providers.map((p) => {
          const opt = PROVIDER_OPTIONS.find((o) => o.name === p.name)
          return (
            <div key={p.id} className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{opt?.label ?? p.name}</span>
                  {p.has_api_key ? (
                    <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded">Key set</span>
                  ) : (
                    <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded">No key</span>
                  )}
                  {p.is_enabled ? (
                    <span className="text-xs bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded">Enabled</span>
                  ) : (
                    <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Disabled</span>
                  )}
                </div>
                {p.base_url && (
                  <p className="text-xs text-gray-500 mt-1">{p.base_url}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">Default model: {opt?.defaultModel ?? 'N/A'}</p>
              </div>
              <button
                onClick={() => { if (confirm(`Delete provider ${p.name}?`)) deleteMutation.mutate(p.id) }}
                className="text-gray-500 hover:text-red-400 p-2"
              >
                <Trash2 size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
