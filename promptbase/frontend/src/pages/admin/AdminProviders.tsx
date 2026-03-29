import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { Plus, Trash2, Key, Check, Pencil, X, Loader2 } from 'lucide-react'

interface Provider {
  id: string
  name: string
  base_url: string | null
  has_api_key: boolean
  is_enabled: boolean
  default_model: string | null
}

const PROVIDER_OPTIONS = [
  { name: 'anthropic', label: 'Anthropic (Claude)' },
  { name: 'openai', label: 'OpenAI (GPT)' },
  { name: 'openrouter', label: 'OpenRouter' },
  { name: 'ollama', label: 'Ollama (Local)' },
]

const DEFAULT_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434',
}

interface ProviderForm {
  name: string
  base_url: string
  api_key: string
  is_enabled: boolean
  default_model: string
}

const emptyForm = (name = 'anthropic'): ProviderForm => ({
  name,
  base_url: DEFAULT_URLS[name] ?? '',
  api_key: '',
  is_enabled: true,
  default_model: '',
})

export default function AdminProviders() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null) // provider id or 'new'
  const [form, setForm] = useState<ProviderForm>(emptyForm())
  const [saved, setSaved] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ provider: string; models: string[]; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ['admin-providers'],
    queryFn: async () => (await api.get('/admin/providers')).data,
  })

  const saveMutation = useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: ProviderForm }) => {
      if (id && id !== 'new') {
        return api.put(`/admin/providers/${id}`, body)
      }
      return api.post('/admin/providers', body)
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
      setEditing(null)
      setForm(emptyForm())
      setTestResult(null)
      setSaved(vars.body.name)
      setTimeout(() => setSaved(null), 3000)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/admin/providers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-providers'] }),
  })

  const startEdit = (provider: Provider) => {
    setForm({
      name: provider.name,
      base_url: provider.base_url ?? '',
      api_key: '', // don't pre-fill key
      is_enabled: provider.is_enabled,
      default_model: provider.default_model ?? '',
    })
    setEditing(provider.id)
    setTestResult(null)
  }

  const startNew = () => {
    setForm(emptyForm())
    setEditing('new')
    setTestResult(null)
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // Save first if new or key changed, so the backend can use the key
      if (editing === 'new' || form.api_key) {
        await api.post('/admin/providers', {
          name: form.name,
          api_key: form.api_key || undefined,
          base_url: form.base_url || undefined,
          is_enabled: form.is_enabled,
        })
        queryClient.invalidateQueries({ queryKey: ['admin-providers'] })
      }
      const res = await api.get(`/admin/providers/${form.name}/models`)
      setTestResult(res.data)
    } catch (err: any) {
      setTestResult({ provider: form.name, models: [], error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const cancelEdit = () => {
    setEditing(null)
    setForm(emptyForm())
    setTestResult(null)
  }

  const opt = (name: string) => PROVIDER_OPTIONS.find((o) => o.name === name)

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">LLM Providers</h2>
          <p className="text-sm text-gray-400 mt-1">Configure API keys and endpoints. Test connection to load available models.</p>
        </div>
        {!editing && (
          <button onClick={startNew} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg">
            <Plus size={16} /> Add Provider
          </button>
        )}
      </div>

      {saved && (
        <div className="mb-4 p-3 bg-green-900/40 border border-green-700 rounded-lg text-green-300 text-sm flex items-center gap-2">
          <Check size={16} /> Provider "{saved}" saved successfully
        </div>
      )}

      {/* Edit / New form */}
      {editing && (
        <div className="mb-6 bg-gray-900 border border-gray-700 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">{editing === 'new' ? 'Add Provider' : 'Edit Provider'}</h3>
            <button onClick={cancelEdit} className="text-gray-500 hover:text-white"><X size={16} /></button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Provider</label>
              <select
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, base_url: DEFAULT_URLS[e.target.value] ?? '' })}
                disabled={editing !== 'new'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                API Key {form.name === 'ollama' && <span className="text-gray-600">(not required)</span>}
              </label>
              <input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={editing !== 'new' ? '••••• (leave blank to keep current)' : 'sk-...'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Base URL</label>
            <input
              type="text"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder={form.name === 'ollama' ? 'http://localhost:11434' : 'Leave blank for default'}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Default Model</label>
            {testResult && !testResult.error && testResult.models.length > 0 ? (
              <select
                value={form.default_model}
                onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="">Auto-detect</option>
                {testResult.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={form.default_model}
                onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                placeholder="Test connection to load models, or type manually"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
              />
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })} className="rounded" />
            Enabled
          </label>

          {/* Test connection */}
          <div className="border-t border-gray-700 pt-4">
            <button
              onClick={testConnection}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
              {testing ? 'Testing…' : 'Test Connection & Load Models'}
            </button>

            {testResult && (
              <div className={`mt-3 p-3 rounded-lg text-sm ${testResult.error ? 'bg-red-900/30 border border-red-800 text-red-300' : 'bg-green-900/30 border border-green-800 text-green-300'}`}>
                {testResult.error ? (
                  <p>Connection failed: {testResult.error}</p>
                ) : (
                  <div>
                    <p className="font-medium mb-2">Connected — {testResult.models.length} models available:</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {testResult.models.map((m) => (
                        <div key={m} className="text-xs text-green-400 font-mono bg-green-900/20 px-2 py-1 rounded">{m}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex gap-2 border-t border-gray-700 pt-4">
            <button
              onClick={() => saveMutation.mutate({ id: editing, body: form })}
              disabled={saveMutation.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save Provider'}
            </button>
            <button onClick={cancelEdit} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Provider list */}
      <div className="space-y-3">
        {providers.length === 0 && !editing && (
          <div className="text-center py-12 text-gray-500">
            <Key size={32} className="mx-auto mb-3 opacity-50" />
            <p>No providers configured yet.</p>
            <p className="text-sm mt-1">Add a provider to start using AI models.</p>
          </div>
        )}
        {providers.map((p) => (
          <div key={p.id} className={`bg-gray-900 border rounded-lg p-4 flex items-center justify-between ${editing === p.id ? 'border-indigo-600' : 'border-gray-700'}`}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-medium">{opt(p.name)?.label ?? p.name}</span>
                {p.has_api_key ? (
                  <span className="text-xs bg-green-900/50 text-green-400 px-2 py-0.5 rounded">Key set</span>
                ) : p.name === 'ollama' ? (
                  <span className="text-xs bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded">No key needed</span>
                ) : (
                  <span className="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded">No key</span>
                )}
                {p.is_enabled ? (
                  <span className="text-xs bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded">Enabled</span>
                ) : (
                  <span className="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded">Disabled</span>
                )}
              </div>
              {p.base_url && <p className="text-xs text-gray-500 mt-1">{p.base_url}</p>}
              {p.default_model && <p className="text-xs text-emerald-500 mt-0.5">Default: {p.default_model}</p>}
            </div>
            <div className="flex gap-1">
              <button onClick={() => startEdit(p)} className="text-gray-500 hover:text-indigo-400 p-2" title="Edit">
                <Pencil size={16} />
              </button>
              <button onClick={() => { if (confirm(`Delete provider ${p.name}?`)) deleteMutation.mutate(p.id) }} className="text-gray-500 hover:text-red-400 p-2" title="Delete">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
