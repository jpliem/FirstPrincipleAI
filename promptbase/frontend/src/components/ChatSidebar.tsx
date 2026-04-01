import { PlusCircle, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Team, Conversation } from '../types'
import ConversationList from './ConversationList'
import ThemeToggle from './ThemeToggle'

interface Props {
  teams: Team[]
  activeTeam: Team | null
  onSelectTeam: (team: Team | null) => void
  activeConversation: Conversation | null
  onSelectConversation: (conv: Conversation) => void
  onNewConversation: () => void
  basicMode: boolean
  onBasicModeChange: (basic: boolean) => void
  onConversationDeleted: () => void
}

export default function ChatSidebar({
  teams, activeTeam, onSelectTeam,
  activeConversation, onSelectConversation, onNewConversation,
  basicMode, onBasicModeChange, onConversationDeleted,
}: Props) {
  const { user, logout } = useAuth()
  const hasTeams = teams.length > 0

  return (
    <aside className="w-72 flex flex-col bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 shrink-0">
      {/* Team selector */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <select
          value={activeTeam?.id ?? 'personal'}
          onChange={(e) => {
            if (e.target.value === 'personal') {
              onSelectTeam(null)
            } else {
              const team = teams.find((t) => t.id === e.target.value)
              if (team) onSelectTeam(team)
            }
          }}
          className="w-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="personal">Personal Chat</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* New chat + mode toggle */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 space-y-2">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <PlusCircle size={16} />
          New Chat
        </button>
        {hasTeams && activeTeam && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-gray-500 dark:text-gray-400">Chat mode</span>
            <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-0.5">
              <button
                onClick={() => onBasicModeChange(true)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  basicMode ? 'bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Basic
              </button>
              <button
                onClick={() => onBasicModeChange(false)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  !basicMode ? 'bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Advanced
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto">
        <ConversationList
          teamId={activeTeam?.id ?? null}
          activeId={activeConversation?.id ?? null}
          onSelect={onSelectConversation}
          onDeleted={() => onConversationDeleted()}
        />
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.name}</span>
        <div className="flex gap-2">
          <ThemeToggle />
          {user?.is_super_admin && (
            <Link to="/admin" className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded transition-colors" title="Admin">
              <Settings size={16} />
            </Link>
          )}
          <button onClick={logout} className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white rounded transition-colors" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
