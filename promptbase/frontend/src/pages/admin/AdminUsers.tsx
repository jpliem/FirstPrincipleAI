import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, ShieldCheck, Trash2, Building2, KeyRound } from 'lucide-react'
import { api } from '../../api/client'
import ResetPasswordModal from '../../components/ResetPasswordModal'

interface TeamMembership {
  team_id: string
  team_name: string
  role: string
}

interface UserInfo {
  id: string
  email: string
  name: string
  is_super_admin: boolean
  is_active: boolean
  created_at: string
  teams: TeamMembership[]
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
}

export default function AdminUsers() {
  const qc = useQueryClient()
  const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: me } = useQuery<UserInfo>({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  const { data: users = [], isLoading } = useQuery<UserInfo[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get('/admin/users')).data,
  })

  const deleteUser = async (userId: string, userName: string) => {
    if (!confirm(`Delete user "${userName}"? This cannot be undone.`)) return
    try {
      await api.delete(`/admin/users/${userId}`)
      qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    } catch (err: any) {
      alert(err.response?.data?.detail ?? 'Failed to delete user')
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {users.length} registered user{users.length !== 1 ? 's' : ''} — invite via Teams page
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-500" /></div>
      ) : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center font-semibold text-sm text-white shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{u.name}</span>
                    {u.is_super_admin && (
                      <span className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 rounded px-1.5 py-0.5">
                        <ShieldCheck size={10} />
                        Super Admin
                      </span>
                    )}
                    {!u.is_active && (
                      <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                        Inactive
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{u.email}</span>
                  {u.teams.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {u.teams.map((t) => (
                        <span
                          key={t.team_id}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50"
                        >
                          <Building2 size={10} />
                          {t.team_name}
                          <span className="text-indigo-400 dark:text-indigo-500">{ROLE_LABEL[t.role] ?? t.role}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1">No team</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(u.created_at).toLocaleDateString()}
                </span>
                {me && u.id !== me.id && (
                  <>
                    <button
                      onClick={() => setResetTarget({ id: u.id, name: u.name })}
                      className="p-1.5 text-gray-400 hover:text-indigo-500 transition-colors shrink-0"
                      title="Reset password"
                    >
                      <KeyRound size={16} />
                    </button>
                    <button
                      onClick={() => deleteUser(u.id, u.name)}
                      className="p-1.5 text-gray-400 hover:text-red-400 transition-colors shrink-0"
                      title="Delete user"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {resetTarget && (
        <ResetPasswordModal
          userId={resetTarget.id}
          userName={resetTarget.name}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  )
}
