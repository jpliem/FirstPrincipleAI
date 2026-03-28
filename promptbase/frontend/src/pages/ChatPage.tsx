import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Team, Conversation } from '../types'
import ChatSidebar from '../components/ChatSidebar'
import ChatMain from '../components/ChatMain'

export default function ChatPage() {
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      return res.data
    },
    onSuccess: (data) => {
      if (data.length > 0 && !activeTeam) setActiveTeam(data[0])
    },
  } as any)

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <ChatSidebar
        teams={teams}
        activeTeam={activeTeam}
        onSelectTeam={setActiveTeam}
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        onNewConversation={() => setActiveConversation(null)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        {activeTeam ? (
          <ChatMain
            team={activeTeam}
            conversation={activeConversation}
            onConversationCreated={setActiveConversation}
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
