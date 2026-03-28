import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Team, Conversation, TaskMode } from '../types'
import ChatSidebar from '../components/ChatSidebar'
import ChatMain from '../components/ChatMain'

export default function ChatPage() {
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeMode, setActiveMode] = useState<TaskMode | null>(null)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      const data = res.data
      if (data.length > 0 && !activeTeam) setActiveTeam(data[0])
      return data
    },
  })

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <ChatSidebar
        teams={teams}
        activeTeam={activeTeam}
        onSelectTeam={(team) => {
          setActiveTeam(team)
          setActiveConversation(null)
          setActiveMode(null)
          setSelectedDocIds([])
        }}
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        onNewConversation={() => {
          setActiveConversation(null)
          setActiveMode(null)
        }}
        onModeChange={setActiveMode}
        onDocumentsChange={setSelectedDocIds}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {activeTeam ? (
          <ChatMain
            team={activeTeam}
            conversation={activeConversation}
            onConversationCreated={setActiveConversation}
            activeMode={activeMode}
            selectedDocIds={selectedDocIds}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Select or create a team to start chatting.</p>
          </div>
        )}
      </main>
    </div>
  )
}
