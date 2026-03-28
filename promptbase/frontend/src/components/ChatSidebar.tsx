import { PlusCircle, LogOut, Settings } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Team, Conversation, TaskMode } from '../types'
import ConversationList from './ConversationList'
import DocumentUpload from './DocumentUpload'
import ModeSelector from './ModeSelector'

interface Props {
  teams: Team[]
  activeTeam: Team | null
  onSelectTeam: (team: Team) => void
  activeConversation: Conversation | null
  onSelectConversation: (conv: Conversation) => void
  onNewConversation: () => void
  onModeChange: (mode: TaskMode | null) => void
  onDocumentsChange: (docIds: string[]) => void
}

export default function ChatSidebar({
  teams, activeTeam, onSelectTeam,
  activeConversation, onSelectConversation, onNewConversation,
  onModeChange, onDocumentsChange,
}: Props) {
  const { user, logout } = useAuth()

  return (
    <aside className="w-72 flex flex-col bg-gray-900 border-r border-gray-800 shrink-0">
      {/* Team selector */}
      <div className="p-4 border-b border-gray-800">
        <select
          value={activeTeam?.id ?? ''}
          onChange={(e) => {
            const team = teams.find((t) => t.id === e.target.value)
            if (team) onSelectTeam(team)
          }}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* New chat button */}
      <div className="p-3 border-b border-gray-800">
        <button
          onClick={onNewConversation}
          className="w-full flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
        >
          <PlusCircle size={16} />
          New Chat
        </button>
      </div>

      {/* Mode selector */}
      {activeTeam && (
        <div className="px-3 py-2 border-b border-gray-800">
          <ModeSelector teamId={activeTeam.id} onModeChange={onModeChange} />
        </div>
      )}

      {/* Document upload */}
      {activeTeam && (
        <div className="px-3 py-2 border-b border-gray-800">
          <DocumentUpload teamId={activeTeam.id} onDocumentsChange={onDocumentsChange} />
        </div>
      )}

      {/* Conversation history */}
      <div className="flex-1 overflow-y-auto">
        {activeTeam && (
          <ConversationList
            teamId={activeTeam.id}
            activeId={activeConversation?.id ?? null}
            onSelect={onSelectConversation}
          />
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-800 flex items-center justify-between">
        <span className="text-xs text-gray-400 truncate">{user?.name}</span>
        <div className="flex gap-2">
          {user?.is_super_admin && (
            <Link to="/admin" className="p-1.5 text-gray-400 hover:text-white rounded transition-colors" title="Admin">
              <Settings size={16} />
            </Link>
          )}
          <button onClick={logout} className="p-1.5 text-gray-400 hover:text-white rounded transition-colors" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}
