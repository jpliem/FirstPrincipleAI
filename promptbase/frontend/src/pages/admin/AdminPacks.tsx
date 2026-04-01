import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Upload, Download, Sliders, Loader2, Sparkles, Check, Trash2 } from 'lucide-react'
import { api, getAccessToken } from '../../api/client'
import type { PromptPack } from '../../types'
import PackBuilderModal from '../../components/PackBuilderModal'

export default function AdminPacks() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderSourceId, setBuilderSourceId] = useState<string | null>(null)
  const [builderSourceName, setBuilderSourceName] = useState<string | null>(null)

  const { data: packs = [], isLoading } = useQuery<PromptPack[]>({
    queryKey: ['admin', 'packs'],
    queryFn: async () => (await api.get('/admin/packs')).data,
  })

  const createPack = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api.post('/admin/packs', { ...body, version: '1.0.0' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
      setCreating(false)
      setNewName('')
      setNewDesc('')
    },
  })

  const importPack = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('name', file.name.replace('.zip', ''))
    await api.post('/admin/packs/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
  }

  const deletePack = async (packId: string, packName: string) => {
    if (!confirm(`Delete "${packName}"? This cannot be undone.`)) return
    try {
      await api.delete(`/admin/packs/${packId}?force=true`)
      qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
    } catch (err: any) {
      alert(err.response?.data?.detail ?? 'Failed to delete pack')
    }
  }

  const exportPack = async (pack: PromptPack) => {
    const token = getAccessToken()
    const res = await fetch(`/api/admin/packs/${pack.id}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pack.name}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Prompt Packs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage prompt instruction packs and their modules
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            multiple
            className="hidden"
            onChange={async (e) => {
              if (!e.target.files) return
              for (const file of Array.from(e.target.files)) {
                await importPack(file)
              }
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 border border-gray-300 dark:border-gray-700 rounded-lg text-sm transition-colors"
          >
            <Upload size={16} />
            Import ZIP
          </button>
          <button
            onClick={() => {
              setBuilderSourceId(null)
              setBuilderSourceName(null)
              setBuilderOpen(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            <Sparkles size={16} />
            Create with AI
          </button>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors"
          >
            <Plus size={16} />
            New Pack
          </button>
        </div>
      </div>

      {creating && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">New Pack</h3>
          <input
            type="text"
            placeholder="Pack name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => createPack.mutate({ name: newName, description: newDesc })}
              disabled={!newName || createPack.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {createPack.isPending ? 'Creating…' : 'Create'}
            </button>
            <button
              onClick={() => setCreating(false)}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-gray-500" />
        </div>
      ) : (
        <div className="space-y-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">{pack.name}</h3>
                    <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                      v{pack.version}
                    </span>
                    <span className="text-xs text-gray-500">
                      {pack.module_count} modules
                    </span>
                  </div>
                  {pack.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{pack.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/admin/packs/${pack.id}/modes`}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Sliders size={14} />
                    Modes
                  </Link>
                  <button
                    onClick={() => exportPack(pack)}
                    className="p-1.5 text-gray-400 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Export ZIP"
                  >
                    <Download size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setBuilderSourceId(pack.id)
                      setBuilderSourceName(pack.name)
                      setBuilderOpen(true)
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Expand with AI"
                  >
                    <Sparkles size={14} />
                    Expand
                  </button>
                  <button
                    onClick={() => deletePack(pack.id, pack.name)}
                    className="p-1.5 text-gray-400 hover:text-red-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    title="Delete pack"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {/* AI Analyzer + Module editor */}
              <PackAnalyzer packId={pack.id} />
              <PackModules packId={pack.id} />
            </div>
          ))}
        </div>
      )}
      {builderOpen && (
        <PackBuilderModal
          sourcePackId={builderSourceId}
          sourcePackName={builderSourceName}
          onClose={() => setBuilderOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['admin', 'packs'] })}
        />
      )}
    </div>
  )
}

function PackAnalyzer({ packId }: { packId: string }) {
  const qc = useQueryClient()
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)

  const analyze = async () => {
    setAnalyzing(true)
    setError(null)
    setResults(null)
    setApplied(false)
    try {
      const res = await api.post(`/admin/packs/${packId}/analyze`)
      if (res.data.error) {
        setError(res.data.error)
        return
      }
      setResults(res.data.analysis)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  const applyAll = async () => {
    if (!results) return
    try {
      await api.post(`/admin/packs/${packId}/apply-analysis`, results)
      qc.invalidateQueries({ queryKey: ['admin', 'modules', packId] })
      setApplied(true)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const LAYER_COLOR: Record<string, string> = {
    core: 'text-blue-400',
    always: 'text-purple-400',
    domain: 'text-green-400',
  }

  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-3">
      <div className="flex items-center gap-2">
        <button
          onClick={analyze}
          disabled={analyzing}
          className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {analyzing ? 'Analyzing with AI...' : 'AI Analyze Modules'}
        </button>
        {applied && <span className="text-xs text-green-500 dark:text-green-400 flex items-center gap-1"><Check size={12} /> Applied</span>}
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}

      {results && !applied && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">AI suggestions for {results.length} modules:</p>
            <button
              onClick={applyAll}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-lg"
            >
              Apply All Suggestions
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {results.map((r: any) => {
              const changed = r.suggested_layer !== r.current_layer ||
                JSON.stringify(r.suggested_tags) !== JSON.stringify(r.current_tags) ||
                r.suggested_priority !== r.current_priority
              return (
                <div key={r.module_id} className={`text-xs px-3 py-2 rounded-lg ${changed ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-700 dark:text-gray-300 font-medium truncate flex-1">{r.filename}</span>
                    {changed && (
                      <span className="text-amber-600 dark:text-amber-400 shrink-0">changed</span>
                    )}
                  </div>
                  {r.suggested_description && (
                    <p className="text-gray-500 mt-0.5">{r.suggested_description}</p>
                  )}
                  {changed && (
                    <div className="mt-1 flex gap-3 text-gray-500">
                      <span>layer: <span className={LAYER_COLOR[r.current_layer] ?? ''}>{r.current_layer}</span> → <span className={LAYER_COLOR[r.suggested_layer] ?? ''}>{r.suggested_layer}</span></span>
                      <span>priority: {r.current_priority} → {r.suggested_priority}</span>
                      {r.suggested_tags?.length > 0 && <span>tags: {r.suggested_tags.join(', ')}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PackModules({ packId }: { packId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: modules = [] } = useQuery({
    queryKey: ['admin', 'modules', packId],
    enabled: expanded,
    queryFn: async () => (await api.get(`/admin/packs/${packId}/modules`)).data,
  })

  const updateModule = useMutation({
    mutationFn: ({ id, body }: any) => api.put(`/admin/modules/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modules', packId] })
      setEditingId(null)
    },
  })

  return (
    <div className="mt-3 border-t border-gray-200 dark:border-gray-800 pt-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
      >
        {expanded ? 'Hide modules' : 'Show modules'}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {modules.map((mod: any) => (
            <ModuleRow
              key={mod.id}
              module={mod}
              isEditing={editingId === mod.id}
              onEdit={() => setEditingId(mod.id)}
              onCancel={() => setEditingId(null)}
              onSave={(body: any) => updateModule.mutate({ id: mod.id, body })}
              saving={updateModule.isPending}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ModuleRow({ module, isEditing, onEdit, onCancel, onSave, saving }: any) {
  const [content, setContent] = useState(module.content)
  const [title, setTitle] = useState(module.title)
  const [tags, setTags] = useState((module.tags ?? []).join(', '))
  const [layer, setLayer] = useState(module.layer)
  const [priority, setPriority] = useState(module.priority)

  const LAYER_COLOR: Record<string, string> = {
    core: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30',
    always: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30',
    domain: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30',
  }

  if (!isEditing) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/50 cursor-pointer group"
        onClick={onEdit}
      >
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${LAYER_COLOR[module.layer] ?? ''}`}>
          {module.layer}
        </span>
        <span className="text-sm text-gray-700 dark:text-gray-300 truncate flex-1">{module.filename}</span>
        <span className="text-xs text-gray-500">{module.token_count} tok</span>
        <span className="text-xs text-indigo-600 dark:text-indigo-400 opacity-0 group-hover:opacity-100">Edit</span>
      </div>
    )
  }

  return (
    <div className="border border-indigo-300 dark:border-indigo-700/50 rounded-xl p-4 bg-gray-50 dark:bg-gray-900/80 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Layer</label>
          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value)}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none"
          >
            <option value="core">core</option>
            <option value="always">always</option>
            <option value="domain">domain</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Priority</label>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tags (comma-separated)</label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1.5 text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Content (Markdown)</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-3 py-2 text-xs text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() =>
            onSave({
              filename: module.filename,
              title,
              layer,
              tags: tags.split(',').map((t: string) => t.trim()).filter(Boolean),
              priority,
              content,
              sort_order: module.sort_order,
            })
          }
          disabled={saving}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium text-white transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-xs transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
