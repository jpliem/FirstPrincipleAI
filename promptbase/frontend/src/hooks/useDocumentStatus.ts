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
