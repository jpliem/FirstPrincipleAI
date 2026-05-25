import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Document } from '../types'

export function useDocuments(teamId: string) {
  return useQuery<Document[]>({
    queryKey: ['documents', teamId],
    queryFn: async () => {
      const res = await api.get(`/documents/${teamId}`)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}

export function useLibraryDocs(teamId: string | null) {
  const key = teamId ?? 'personal'
  const url = teamId ? `/documents/${teamId}/library` : '/documents/personal/library'
  return useQuery<Document[]>({
    queryKey: ['library-docs', key],
    queryFn: async () => {
      const res = await api.get(url)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}

export function useConversationDocs(conversationId: string | null) {
  return useQuery<Document[]>({
    queryKey: ['conversation-docs', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const res = await api.get(`/documents/conversation/${conversationId}`)
      return res.data.documents
    },
    refetchInterval: (query) => {
      const docs = query.state.data ?? []
      const hasActive = docs.some(
        (d) => d.status === 'pending' || d.status === 'processing'
      )
      return hasActive ? 3_000 : false
    },
  })
}
