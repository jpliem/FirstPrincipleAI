import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { api } from '../../api/client'
import type { TaskMode } from '../../types'

export default function AdminModes() {
  const { packId } = useParams<{ packId: string }>()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', prompt_text: '', form_schema: '' })
  const [schemaError, setSchemaError] = useState<string | null>(null)

  const { data: modes = [], isLoading } = useQuery<TaskMode[]>({
    queryKey: ['admin', 'modes', packId],
    enabled: !!packId,
    queryFn: async () => (await api.get(`/admin/packs/${packId}/modes`)).data,
  })

  const createMode = useMutation({
    mutationFn: (body: any) => api.post(`/admin/packs/${packId}/modes`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'modes', packId] })
      setCreating(false)
      setForm({ name: '', prompt_text: '', form_schema: '' })
    },
  })

  const deleteMode = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/modes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'modes', packId] }),
  })

  const handleCreate = () => {
    setSchemaError(null)
    let parsedSchema = null
    if (form.form_schema.trim()) {
      try {
        parsedSchema = JSON.parse(form.form_schema)
      } catch {
        setSchemaError('Invalid JSON in form schema')
        return
      }
    }
    createMode.mutate({
      name: form.name,
      prompt_text: form.prompt_text,
      form_schema: parsedSchema,
      sort_order: modes.length,
    })
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Task Modes</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Define structured input modes for pack {packId?.slice(0, 8)}…
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Plus size={16} />
          New Mode
        </button>
      </div>

      {creating && (
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl space-y-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">New Task Mode</h3>
          <input
            type="text"
            placeholder="Mode name (e.g. tender_response)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <textarea
            placeholder="Prompt text appended to system prompt when this mode is active…"
            value={form.prompt_text}
            onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
            rows={5}
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
          />
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              Form Schema (JSON, optional) — defines input fields shown to users
            </label>
            <textarea
              placeholder={`{\n  "project_name": { "type": "text", "label": "Project Name", "required": true },\n  "scope": { "type": "textarea", "label": "Scope Description" }\n}`}
              value={form.form_schema}
              onChange={(e) => setForm({ ...form, form_schema: e.target.value })}
              rows={6}
              className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-none"
            />
            {schemaError && <p className="text-xs text-red-400 mt-1">{schemaError}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!form.name || !form.prompt_text || createMode.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {createMode.isPending ? 'Creating…' : 'Create'}
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
          {modes.map((mode) => (
            <div key={mode.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-900 dark:text-white">{mode.name}</h3>
                <button
                  onClick={() => deleteMode.mutate(mode.id)}
                  className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 font-mono bg-gray-100 dark:bg-gray-800 rounded p-2 mb-2 whitespace-pre-wrap line-clamp-3">
                {mode.prompt_text}
              </p>
              {mode.form_schema && (
                <div className="text-xs text-gray-500">
                  Form fields: {Object.keys(mode.form_schema).join(', ')}
                </div>
              )}
            </div>
          ))}
          {modes.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No modes defined yet</p>
          )}
        </div>
      )}
    </div>
  )
}
