import { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Team, Conversation, TaskMode } from '../types'
import ChatSidebar from '../components/ChatSidebar'
import ChatMain from '../components/ChatMain'

export default function ChatPage() {
  const queryClient = useQueryClient()
  const [activeTeam, setActiveTeam] = useState<Team | null>(null)
  const [teamInitialized, setTeamInitialized] = useState(false)
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [activeMode, setActiveMode] = useState<TaskMode | null>(null)
  const [basicMode, setBasicMode] = useState(false)

  const { data: teams = [] } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get('/auth/teams')
      const data = res.data
      if (!teamInitialized) {
        if (data.length > 0) setActiveTeam(data[0])
        setTeamInitialized(true)
      }
      return data
    },
  })

  const effectiveBasicMode = !activeTeam ? true : basicMode

  const handleTitleChanged = useCallback((convId: string, title: string) => {
    setActiveConversation((prev) => prev && prev.id === convId ? { ...prev, title } : prev)
    queryClient.invalidateQueries({ queryKey: ['conversations'] })
  }, [queryClient])

  return (
    <div className="flex h-screen bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-100 overflow-hidden">
      <ChatSidebar
        teams={teams}
        activeTeam={activeTeam}
        onSelectTeam={(team) => {
          setActiveTeam(team)
          setActiveConversation(null)
          setActiveMode(null)
          if (!team) setBasicMode(true)
        }}
        activeConversation={activeConversation}
        onSelectConversation={setActiveConversation}
        onNewConversation={() => {
          setActiveConversation(null)
          setActiveMode(null)
        }}
        basicMode={effectiveBasicMode}
        onBasicModeChange={setBasicMode}
        onConversationDeleted={() => setActiveConversation(null)}
      />
      <main className="flex-1 flex flex-col min-w-0">
        <ChatMain
          team={activeTeam}
          conversation={activeConversation}
          onConversationCreated={setActiveConversation}
          onConversationTitleChanged={handleTitleChanged}
          activeMode={activeTeam ? activeMode : null}
          onModeChange={setActiveMode}
          basicMode={effectiveBasicMode}
        />
      </main>
    </div>
  )
}
