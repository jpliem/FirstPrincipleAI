import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Trash2, Pin, Search, Pencil } from 'lucide-react'
import { api } from '../api/client'
import type { Conversation } from '../types'
import ContextMenu from './ContextMenu'

interface Props {
  teamId: string | null
  activeId: string | null
  onSelect: (conv: Conversation) => void
  onDeleted: (convId: string) => void
}

export default function ConversationList({ teamId, activeId, onSelect, onDeleted }: Props) {
  const queryClient = useQueryClient()
  const queryKey = ['conversations', teamId ?? 'personal']
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; conv: Conversation } | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data, isLoading } = useQuery({
    queryKey: [...queryKey, debouncedSearch],
    queryFn: async () => {
      const base = teamId ? `/chat/conversations/${teamId}` : '/chat/conversations/personal'
      const params = debouncedSearch ? `?q=${encodeURIComponent(debouncedSearch)}` : ''
      const res = await api.get(`${base}${params}`)
      return res.data.conversations as Conversation[]
    },
    refetchInterval: 10_000,
  })

  const conversations = data ?? []
  const pinned = conversations.filter((c) => c.is_pinned)
  const unpinned = conversations.filter((c) => !c.is_pinned)

  const handleDelete = async (conv: Conversation) => {
    const deleteUrl = teamId
      ? `/chat/conversations/${teamId}/${conv.id}`
      : `/chat/conversations/personal/${conv.id}`
    await api.delete(deleteUrl)
    queryClient.invalidateQueries({ queryKey })
    if (conv.id === activeId) onDeleted(conv.id)
  }

  const handleTogglePin = async (conv: Conversation) => {
    await api.patch(`/chat/conversations/${conv.id}`, { is_pinned: !conv.is_pinned })
    queryClient.invalidateQueries({ queryKey })
  }

  const startRename = (conv: Conversation) => {
    setEditingId(conv.id)
    setEditTitle(conv.title)
    setTimeout(() => editRef.current?.focus(), 50)
  }

  const saveRename = async () => {
    if (!editingId || !editTitle.trim()) { setEditingId(null); return }
    await api.patch(`/chat/conversations/${editingId}`, { title: editTitle.trim() })
    setEditingId(null)
    queryClient.invalidateQueries({ queryKey })
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, conv: Conversation) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, conv })
  }, [])

  const renderItem = (conv: Conversation) => {
    const isEditing = editingId === conv.id
    return (
      <div
        key={conv.id}
        onClick={() => !isEditing && onSelect(conv)}
        onDoubleClick={() => startRename(conv)}
        onContextMenu={(e) => handleContextMenu(e, conv)}
        className={`group w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
          conv.id === activeId
            ? 'bg-indigo-600/20 text-indigo-600 dark:text-indigo-300'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
        }`}
      >
        {conv.is_pinned && <Pin size={10} className="shrink-0 text-indigo-400 -rotate-45" />}
        {!conv.is_pinned && <MessageCircle size={14} className="shrink-0 text-gray-500" />}
        {isEditing ? (
          <input
            ref={editRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename()
              if (e.key === 'Escape') setEditingId(null)
            }}
            onBlur={saveRename}
            className="flex-1 bg-white dark:bg-gray-700 border border-indigo-400 rounded px-1 py-0.5 text-sm outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1">{conv.title || 'Untitled'}</span>
        )}
        {!isEditing && conv.mode && (
          <span className="shrink-0 text-xs text-gray-500 bg-gray-200 dark:bg-gray-800 rounded px-1.5 py-0.5 group-hover:hidden">
            {conv.mode}
          </span>
        )}
        {!isEditing && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(conv) }}
            className="hidden group-hover:block shrink-0 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete conversation"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 bg-gray-200 dark:bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="p-2 space-y-0.5">
      {/* Search */}
      <div className="relative px-1 mb-2">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg pl-7 pr-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Pinned */}
      {pinned.length > 0 && (
        <>
          <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">Pinned</p>
          {pinned.map(renderItem)}
          <div className="border-b border-gray-200 dark:border-gray-800 mx-2 my-1" />
        </>
      )}

      {/* History */}
      <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">History</p>
      {unpinned.map(renderItem)}
      {conversations.length === 0 && (
        <p className="px-3 py-2 text-sm text-gray-500">
          {debouncedSearch ? 'No matches' : 'No conversations yet'}
        </p>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: 'Rename', icon: <Pencil size={12} />, onClick: () => startRename(ctxMenu.conv) },
            { label: ctxMenu.conv.is_pinned ? 'Unpin' : 'Pin', icon: <Pin size={12} />, onClick: () => handleTogglePin(ctxMenu.conv) },
            { label: 'Delete', icon: <Trash2 size={12} />, onClick: () => handleDelete(ctxMenu.conv), danger: true },
          ]}
        />
      )}
    </div>
  )
}
