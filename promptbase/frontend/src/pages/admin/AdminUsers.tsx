import { useQuery } from '@tanstack/react-query'
import { Loader2, ShieldCheck } from 'lucide-react'
import { api } from '../../api/client'
import type { User, Team } from '../../types'

// Note: user listing requires a super-admin endpoint (GET /api/admin/users).
// If not yet implemented on the backend, this page shows a placeholder.
// The invite workflow is on the Teams page.

export default function AdminUsers() {
  // Fallback: show current user info via /auth/me and note invite flow
  const { data: me } = useQuery<User>({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ['admin', 'teams'],
    queryFn: async () => (await api.get('/auth/teams')).data,
  })

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Users</h1>
        <p className="text-sm text-gray-400 mt-1">
          User management — invite via Teams page, manage roles here
        </p>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
        <h3 className="text-sm font-semibold text-white mb-3">Current User</h3>
        {me && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-semibold text-sm">
              {me.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{me.name}</span>
                {me.is_super_admin && (
                  <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-900/30 rounded px-1.5 py-0.5">
                    <ShieldCheck size={10} />
                    Super Admin
                  </span>
                )}
              </div>
              <span className="text-xs text-gray-400">{me.email}</span>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-1">Teams ({teams.length})</h3>
        <p className="text-xs text-gray-500 mb-3">
          To invite users to a team, go to the Teams page and generate an invite link.
        </p>
        {isLoading ? (
          <Loader2 className="animate-spin text-gray-500" />
        ) : (
          <ul className="space-y-1">
            {teams.map((t) => (
              <li key={t.id} className="text-sm text-gray-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                {t.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
