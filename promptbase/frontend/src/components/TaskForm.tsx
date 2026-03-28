import type { FormField } from '../types'

interface Props {
  schema: Record<string, FormField>
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
}

export default function TaskForm({ schema, values, onChange }: Props) {
  const set = (key: string, val: string) => onChange({ ...values, [key]: val })

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Task Fields</p>
      {Object.entries(schema).map(([key, field]) => (
        <div key={key}>
          <label className="block text-xs font-medium text-gray-300 mb-1">
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </label>
          {field.type === 'textarea' ? (
            <textarea
              value={values[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          ) : field.type === 'select' ? (
            <select
              value={values[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
              required={field.required}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select…</option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              type={field.type === 'number' ? 'number' : 'text'}
              value={values[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
              placeholder={field.placeholder}
              required={field.required}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          )}
        </div>
      ))}
    </div>
  )
}
