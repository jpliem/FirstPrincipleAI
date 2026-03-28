# PromptBase Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PromptBase frontend — a React SPA with chat interface, document upload, task forms, admin dashboard, and export controls.

**Architecture:** React 18 + TypeScript + Vite + Tailwind CSS. TanStack Query for data fetching. React Router for routing. SSE via EventSource for chat streaming.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Axios

**Spec:** `docs/superpowers/specs/2026-03-27-promptbase-design.md`

---

## Phase 1: Scaffold

### Task 1 — Create Vite + React + TypeScript + Tailwind project

**Files to create:** `frontend/` (entire directory scaffold)

- [ ] From `promptbase/` run:
  ```bash
  npm create vite@latest frontend -- --template react-ts
  cd frontend
  npm install
  ```

- [ ] Install all dependencies:
  ```bash
  npm install \
    react-router-dom \
    @tanstack/react-query \
    axios \
    tailwindcss @tailwindcss/vite \
    lucide-react \
    react-markdown \
    remark-gfm
  ```

- [ ] Replace `frontend/vite.config.ts`:
  ```ts
  import { defineConfig } from 'vite'
  import react from '@vitejs/plugin-react'
  import tailwindcss from '@tailwindcss/vite'

  export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  })
  ```

- [ ] Replace `frontend/src/index.css`:
  ```css
  @import "tailwindcss";
  ```

- [ ] Replace `frontend/index.html`:
  ```html
  <!doctype html>
  <html lang="en" class="h-full">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>PromptBase</title>
    </head>
    <body class="h-full bg-gray-950 text-gray-100">
      <div id="root" class="h-full"></div>
      <script type="module" src="/src/main.tsx"></script>
    </body>
  </html>
  ```

---

### Task 2 — Project structure and shared types

**Files to create:**
- `frontend/src/types/index.ts`
- `frontend/src/api/client.ts`
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`

- [ ] Create `frontend/src/types/index.ts`:
  ```ts
  export interface User {
    id: string
    email: string
    name: string
    is_super_admin: boolean
    is_active: boolean
    created_at: string
  }

  export interface Team {
    id: string
    name: string
    description: string
    pack_id: string | null
    created_at: string
  }

  export interface TokenResponse {
    access_token: string
    refresh_token: string
    token_type: string
  }

  export interface Conversation {
    id: string
    title: string
    mode: string | null
    created_at: string
    updated_at: string
    message_count: number
  }

  export interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    token_count: number
    created_at: string
  }

  export interface Document {
    id: string
    filename: string
    file_type: string
    file_size: number
    status: 'pending' | 'processing' | 'ready' | 'failed'
    strategy: 'full_inject' | 'rag' | null
    token_count: number
    created_at: string
  }

  export interface PromptPack {
    id: string
    name: string
    version: string
    description: string
    team_id: string | null
    created_at: string
    module_count: number
  }

  export interface PromptModule {
    id: string
    filename: string
    title: string
    layer: 'core' | 'domain' | 'always'
    tags: string[]
    priority: number
    content: string
    token_count: number
    sort_order: number
  }

  export interface TaskMode {
    id: string
    name: string
    prompt_text: string
    form_schema: Record<string, FormField> | null
    sort_order: number
  }

  export interface FormField {
    type: 'text' | 'textarea' | 'select' | 'multiselect' | 'number'
    label: string
    placeholder?: string
    options?: string[]
    required?: boolean
  }
  ```

- [ ] Create `frontend/src/api/client.ts`:
  ```ts
  import axios from 'axios'

  // Access token stored in memory only (security: not persisted to localStorage)
  let accessToken: string | null = null

  export function setAccessToken(token: string | null) {
    accessToken = token
  }

  export function getAccessToken(): string | null {
    return accessToken
  }

  export const api = axios.create({
    baseURL: '/api',
    headers: { 'Content-Type': 'application/json' },
  })

  // Attach Bearer token on every request
  api.interceptors.request.use((config) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  })

  // Auto-refresh on 401
  api.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config
      if (error.response?.status === 401 && !original._retry) {
        original._retry = true
        const refreshToken = localStorage.getItem('refresh_token')
        if (refreshToken) {
          try {
            const { data } = await axios.post('/api/auth/refresh', null, {
              params: { refresh_token: refreshToken },
            })
            setAccessToken(data.access_token)
            localStorage.setItem('refresh_token', data.refresh_token)
            original.headers.Authorization = `Bearer ${data.access_token}`
            return api(original)
          } catch {
            setAccessToken(null)
            localStorage.removeItem('refresh_token')
            window.location.href = '/login'
          }
        } else {
          window.location.href = '/login'
        }
      }
      return Promise.reject(error)
    }
  )
  ```

- [ ] Create `frontend/src/main.tsx`:
  ```tsx
  import React from 'react'
  import ReactDOM from 'react-dom/client'
  import { BrowserRouter } from 'react-router-dom'
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
  import App from './App'
  import './index.css'

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
      },
    },
  })

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  )
  ```

---

## Phase 2: Auth

### Task 3 — Auth context, hooks, login and register pages

**Files to create:**
- `frontend/src/contexts/AuthContext.tsx`
- `frontend/src/hooks/useAuth.ts`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/RegisterPage.tsx`
- `frontend/src/components/ProtectedRoute.tsx`

- [ ] Create `frontend/src/contexts/AuthContext.tsx`:
  ```tsx
  import React, { createContext, useContext, useEffect, useState } from 'react'
  import { api, setAccessToken } from '../api/client'
  import type { User } from '../types'

  interface AuthState {
    user: User | null
    isLoading: boolean
    login: (email: string, password: string) => Promise<void>
    register: (email: string, password: string, name: string) => Promise<void>
    logout: () => void
  }

  const AuthContext = createContext<AuthState | null>(null)

  export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [isLoading, setIsLoading] = useState(true)

    // On mount, try to restore session from stored refresh token
    useEffect(() => {
      const init = async () => {
        const refreshToken = localStorage.getItem('refresh_token')
        if (!refreshToken) { setIsLoading(false); return }
        try {
          const { data } = await api.post('/auth/refresh', null, {
            params: { refresh_token: refreshToken },
          })
          setAccessToken(data.access_token)
          localStorage.setItem('refresh_token', data.refresh_token)
          const me = await api.get('/auth/me')
          setUser(me.data)
        } catch {
          localStorage.removeItem('refresh_token')
        } finally {
          setIsLoading(false)
        }
      }
      init()
    }, [])

    const login = async (email: string, password: string) => {
      const { data } = await api.post('/auth/login', { email, password })
      setAccessToken(data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      const me = await api.get('/auth/me')
      setUser(me.data)
    }

    const register = async (email: string, password: string, name: string) => {
      const { data } = await api.post('/auth/register', { email, password, name })
      setAccessToken(data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      const me = await api.get('/auth/me')
      setUser(me.data)
    }

    const logout = () => {
      setAccessToken(null)
      localStorage.removeItem('refresh_token')
      setUser(null)
    }

    return (
      <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
        {children}
      </AuthContext.Provider>
    )
  }

  export function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
  }
  ```

- [ ] Create `frontend/src/hooks/useAuth.ts`:
  ```ts
  // Re-export from context for convenience
  export { useAuth } from '../contexts/AuthContext'
  ```

- [ ] Create `frontend/src/pages/LoginPage.tsx`:
  ```tsx
  import { useState } from 'react'
  import { Link, useNavigate } from 'react-router-dom'
  import { useAuth } from '../contexts/AuthContext'

  export default function LoginPage() {
    const { login } = useAuth()
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)
      try {
        await login(email, password)
        navigate('/')
      } catch (err: any) {
        setError(err.response?.data?.detail ?? 'Login failed')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-full max-w-md bg-gray-900 rounded-xl p-8 shadow-xl border border-gray-800">
          <h1 className="text-2xl font-bold text-white mb-2">Sign in to PromptBase</h1>
          <p className="text-gray-400 mb-6 text-sm">
            No account?{' '}
            <Link to="/register" className="text-indigo-400 hover:text-indigo-300">
              Register
            </Link>
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/pages/RegisterPage.tsx`:
  ```tsx
  import { useState } from 'react'
  import { Link, useNavigate } from 'react-router-dom'
  import { useAuth } from '../contexts/AuthContext'

  export default function RegisterPage() {
    const { register } = useAuth()
    const navigate = useNavigate()
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)
      try {
        await register(email, password, name)
        navigate('/')
      } catch (err: any) {
        setError(err.response?.data?.detail ?? 'Registration failed')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-full max-w-md bg-gray-900 rounded-xl p-8 shadow-xl border border-gray-800">
          <h1 className="text-2xl font-bold text-white mb-2">Create account</h1>
          <p className="text-gray-400 mb-6 text-sm">
            Already have one?{' '}
            <Link to="/login" className="text-indigo-400 hover:text-indigo-300">
              Sign in
            </Link>
          </p>

          {error && (
            <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/components/ProtectedRoute.tsx`:
  ```tsx
  import { Navigate } from 'react-router-dom'
  import { useAuth } from '../contexts/AuthContext'

  interface Props {
    children: React.ReactNode
    requireAdmin?: boolean
  }

  export default function ProtectedRoute({ children, requireAdmin = false }: Props) {
    const { user, isLoading } = useAuth()

    if (isLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )
    }

    if (!user) return <Navigate to="/login" replace />
    if (requireAdmin && !user.is_super_admin) return <Navigate to="/" replace />

    return <>{children}</>
  }
  ```

- [ ] Update `frontend/src/App.tsx` with routing:
  ```tsx
  import { Routes, Route, Navigate } from 'react-router-dom'
  import { AuthProvider } from './contexts/AuthContext'
  import ProtectedRoute from './components/ProtectedRoute'
  import LoginPage from './pages/LoginPage'
  import RegisterPage from './pages/RegisterPage'
  import ChatPage from './pages/ChatPage'
  import AdminLayout from './pages/admin/AdminLayout'
  import AdminPacks from './pages/admin/AdminPacks'
  import AdminModes from './pages/admin/AdminModes'
  import AdminTeams from './pages/admin/AdminTeams'
  import AdminUsers from './pages/admin/AdminUsers'

  export default function App() {
    return (
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="packs" replace />} />
            <Route path="packs" element={<AdminPacks />} />
            <Route path="packs/:packId/modes" element={<AdminModes />} />
            <Route path="teams" element={<AdminTeams />} />
            <Route path="users" element={<AdminUsers />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    )
  }
  ```

---

## Phase 3: Chat

### Task 4 — Team selector and chat page layout

**Files to create:**
- `frontend/src/pages/ChatPage.tsx`
- `frontend/src/components/ChatSidebar.tsx`
- `frontend/src/components/ConversationList.tsx`

- [ ] Create `frontend/src/pages/ChatPage.tsx`:
  ```tsx
  import { useState } from 'react'
  import { useQuery } from '@tanstack/react-query'
  import { api } from '../api/client'
  import type { Team, Conversation, Message } from '../types'
  import ChatSidebar from '../components/ChatSidebar'
  import ChatMain from '../components/ChatMain'

  export default function ChatPage() {
    const [activeTeam, setActiveTeam] = useState<Team | null>(null)
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
    const [streamingMessages, setStreamingMessages] = useState<Message[]>([])

    const { data: teams = [] } = useQuery<Team[]>({
      queryKey: ['teams'],
      queryFn: async () => {
        const res = await api.get('/auth/teams')
        return res.data
      },
      onSuccess: (data) => {
        if (data.length > 0 && !activeTeam) setActiveTeam(data[0])
      },
    })

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
  ```

- [ ] Create `frontend/src/components/ChatSidebar.tsx`:
  ```tsx
  import { PlusCircle, LogOut, Settings } from 'lucide-react'
  import { Link } from 'react-router-dom'
  import { useAuth } from '../contexts/AuthContext'
  import type { Team, Conversation } from '../types'
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
  }

  export default function ChatSidebar({
    teams, activeTeam, onSelectTeam,
    activeConversation, onSelectConversation, onNewConversation,
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
            <ModeSelector teamId={activeTeam.id} />
          </div>
        )}

        {/* Document upload */}
        {activeTeam && (
          <div className="px-3 py-2 border-b border-gray-800">
            <DocumentUpload teamId={activeTeam.id} />
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
              <Link
                to="/admin"
                className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
                title="Admin"
              >
                <Settings size={16} />
              </Link>
            )}
            <button
              onClick={logout}
              className="p-1.5 text-gray-400 hover:text-white rounded transition-colors"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    )
  }
  ```

- [ ] Create `frontend/src/components/ConversationList.tsx`:
  ```tsx
  import { useQuery } from '@tanstack/react-query'
  import { MessageCircle } from 'lucide-react'
  import { api } from '../api/client'
  import type { Conversation } from '../types'

  interface Props {
    teamId: string
    activeId: string | null
    onSelect: (conv: Conversation) => void
  }

  export default function ConversationList({ teamId, activeId, onSelect }: Props) {
    const { data, isLoading } = useQuery({
      queryKey: ['conversations', teamId],
      queryFn: async () => {
        const res = await api.get(`/chat/conversations/${teamId}`)
        return res.data.conversations as Conversation[]
      },
      refetchInterval: 10_000,
    })

    if (isLoading) {
      return (
        <div className="p-4 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-9 bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )
    }

    return (
      <div className="p-2 space-y-0.5">
        <p className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          History
        </p>
        {(data ?? []).map((conv) => (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
              conv.id === activeId
                ? 'bg-indigo-600/20 text-indigo-300'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            }`}
          >
            <MessageCircle size={14} className="shrink-0 text-gray-500" />
            <span className="truncate">{conv.title || 'Untitled'}</span>
            {conv.mode && (
              <span className="ml-auto shrink-0 text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
                {conv.mode}
              </span>
            )}
          </button>
        ))}
        {(data ?? []).length === 0 && (
          <p className="px-3 py-2 text-sm text-gray-500">No conversations yet</p>
        )}
      </div>
    )
  }
  ```

---

### Task 5 — SSE streaming hook and chat message components

**Files to create:**
- `frontend/src/hooks/useSSE.ts`
- `frontend/src/components/ChatMessage.tsx`
- `frontend/src/components/ChatMain.tsx`
- `frontend/src/components/ChatInput.tsx`

- [ ] Create `frontend/src/hooks/useSSE.ts`:
  ```ts
  import { useRef, useCallback } from 'react'
  import { getAccessToken } from '../api/client'

  interface SSEOptions {
    onToken: (token: string) => void
    onConversationId: (id: string) => void
    onDone: () => void
    onError: (err: string) => void
  }

  export function useSSE() {
    const abortRef = useRef<AbortController | null>(null)

    const startStream = useCallback(
      async (
        body: {
          message: string
          team_id: string
          conversation_id?: string | null
          document_ids?: string[]
          mode?: string | null
        },
        opts: SSEOptions
      ) => {
        // Cancel any existing stream
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        const token = getAccessToken()
        try {
          const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          })

          if (!res.ok) {
            opts.onError(`Request failed: ${res.status}`)
            return
          }

          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6).trim()
              if (data === '[DONE]') { opts.onDone(); return }
              // First event contains conversation_id JSON
              try {
                const parsed = JSON.parse(data)
                if (parsed.conversation_id) {
                  opts.onConversationId(parsed.conversation_id)
                  continue
                }
              } catch {}
              // Otherwise it's a token (newlines escaped as \\n)
              opts.onToken(data.replace(/\\n/g, '\n'))
            }
          }
          opts.onDone()
        } catch (err: any) {
          if (err.name !== 'AbortError') opts.onError(err.message)
        }
      },
      []
    )

    const cancel = useCallback(() => {
      abortRef.current?.abort()
    }, [])

    return { startStream, cancel }
  }
  ```

- [ ] Create `frontend/src/components/ChatMessage.tsx`:
  ```tsx
  import ReactMarkdown from 'react-markdown'
  import remarkGfm from 'remark-gfm'
  import { User, Bot } from 'lucide-react'
  import type { Message } from '../types'
  import ExportButton from './ExportButton'

  interface Props {
    message: Message
    isStreaming?: boolean
  }

  export default function ChatMessage({ message, isStreaming = false }: Props) {
    const isUser = message.role === 'user'

    return (
      <div className={`flex gap-3 px-4 py-4 ${isUser ? '' : 'bg-gray-900/40'}`}>
        <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-indigo-600' : 'bg-gray-700'
        }`}>
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ children }) => (
                  <div className="overflow-x-auto">
                    <table className="border-collapse border border-gray-700 text-sm">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-gray-700 bg-gray-800 px-3 py-1.5 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-gray-700 px-3 py-1.5">{children}</td>
                ),
                code: ({ inline, children }: any) =>
                  inline ? (
                    <code className="bg-gray-800 text-indigo-300 px-1 rounded text-xs">{children}</code>
                  ) : (
                    <pre className="bg-gray-800 rounded-lg p-3 overflow-x-auto text-xs">
                      <code>{children}</code>
                    </pre>
                  ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5" />
            )}
          </div>
          {!isUser && !isStreaming && message.id && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-gray-600">{message.token_count} tokens</span>
              <ExportButton messageId={message.id} />
            </div>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/components/ChatInput.tsx`:
  ```tsx
  import { useState, useRef } from 'react'
  import { Send, Square } from 'lucide-react'
  import TaskForm from './TaskForm'
  import type { TaskMode } from '../types'

  interface Props {
    onSend: (message: string, formData?: Record<string, string>) => void
    onCancel: () => void
    isStreaming: boolean
    activeMode: TaskMode | null
  }

  export default function ChatInput({ onSend, onCancel, isStreaming, activeMode }: Props) {
    const [text, setText] = useState('')
    const [formData, setFormData] = useState<Record<string, string>>({})
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      const message = text.trim()
      if (!message && !activeMode?.form_schema) return
      onSend(message, Object.keys(formData).length > 0 ? formData : undefined)
      setText('')
      setFormData({})
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e)
      }
    }

    return (
      <div className="border-t border-gray-800 bg-gray-950 p-4">
        {activeMode?.form_schema && (
          <div className="mb-3">
            <TaskForm schema={activeMode.form_schema} values={formData} onChange={setFormData} />
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
            placeholder={activeMode ? `${activeMode.name} — describe your request…` : 'Message…'}
            className="flex-1 resize-none bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] max-h-48 overflow-y-auto"
            style={{ fieldSizing: 'content' } as any}
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex-shrink-0 w-10 h-10 bg-red-700 hover:bg-red-600 rounded-xl flex items-center justify-center transition-colors"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim() && !activeMode?.form_schema}
              className="flex-shrink-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors"
            >
              <Send size={16} />
            </button>
          )}
        </form>
        <p className="text-xs text-gray-600 mt-2 text-center">Enter to send · Shift+Enter for newline</p>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/components/ChatMain.tsx`:
  ```tsx
  import { useState, useEffect, useRef } from 'react'
  import { useQuery, useQueryClient } from '@tanstack/react-query'
  import { api } from '../api/client'
  import { useSSE } from '../hooks/useSSE'
  import type { Team, Conversation, Message, TaskMode } from '../types'
  import ChatMessage from './ChatMessage'
  import ChatInput from './ChatInput'
  import ExportButton from './ExportButton'

  interface Props {
    team: Team
    conversation: Conversation | null
    onConversationCreated: (conv: Conversation) => void
  }

  export default function ChatMain({ team, conversation, onConversationCreated }: Props) {
    const queryClient = useQueryClient()
    const { startStream, cancel } = useSSE()
    const [isStreaming, setIsStreaming] = useState(false)
    const [streamBuffer, setStreamBuffer] = useState('')
    const [activeMode, setActiveMode] = useState<TaskMode | null>(null)
    const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
    const [conversationId, setConversationId] = useState<string | null>(conversation?.id ?? null)
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setConversationId(conversation?.id ?? null)
    }, [conversation])

    const { data: messages = [] } = useQuery<Message[]>({
      queryKey: ['messages', team.id, conversationId],
      enabled: !!conversationId,
      queryFn: async () => {
        const res = await api.get(`/chat/conversations/${team.id}/${conversationId}/messages`)
        return res.data
      },
    })

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, streamBuffer])

    const handleSend = async (text: string, formData?: Record<string, string>) => {
      let message = text
      if (formData && Object.keys(formData).length > 0) {
        const fields = Object.entries(formData)
          .map(([k, v]) => `**${k}:** ${v}`)
          .join('\n')
        message = text ? `${text}\n\n${fields}` : fields
      }

      setIsStreaming(true)
      setStreamBuffer('')

      // Optimistically add user message to UI
      const tempUserMsg: Message = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: message,
        token_count: 0,
        created_at: new Date().toISOString(),
      }
      queryClient.setQueryData<Message[]>(
        ['messages', team.id, conversationId],
        (old) => [...(old ?? []), tempUserMsg]
      )

      await startStream(
        {
          message,
          team_id: team.id,
          conversation_id: conversationId,
          document_ids: selectedDocIds,
          mode: activeMode?.name ?? null,
        },
        {
          onConversationId: (id) => {
            setConversationId(id)
            // Trigger conversation list refresh
            queryClient.invalidateQueries({ queryKey: ['conversations', team.id] })
            // If brand new conversation, notify parent
            if (!conversationId) {
              onConversationCreated({
                id, title: 'New conversation', mode: activeMode?.name ?? null,
                created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                message_count: 1,
              })
            }
          },
          onToken: (token) => {
            setStreamBuffer((prev) => prev + token)
          },
          onDone: () => {
            setIsStreaming(false)
            setStreamBuffer('')
            // Refresh messages from server to get persisted IDs
            queryClient.invalidateQueries({ queryKey: ['messages', team.id, conversationId] })
          },
          onError: (err) => {
            setIsStreaming(false)
            setStreamBuffer('')
            console.error('SSE error:', err)
          },
        }
      )
    }

    const allMessages = [...messages]

    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950 shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-white">
              {conversation?.title ?? 'New Conversation'}
            </h1>
            <p className="text-xs text-gray-500">{team.name}{activeMode && ` · ${activeMode.name}`}</p>
          </div>
          {conversationId && (
            <ExportButton conversationId={conversationId} label="Export Conversation" />
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-800/50">
          {allMessages.length === 0 && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <p className="text-lg font-medium text-gray-400">Start a conversation</p>
              <p className="text-sm">Upload documents in the sidebar, then ask questions about them.</p>
            </div>
          )}
          {allMessages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          {isStreaming && streamBuffer && (
            <ChatMessage
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamBuffer,
                token_count: 0,
                created_at: new Date().toISOString(),
              }}
              isStreaming
            />
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          onCancel={cancel}
          isStreaming={isStreaming}
          activeMode={activeMode}
        />
      </div>
    )
  }
  ```

---

## Phase 4: Documents

### Task 6 — Document upload component and status polling

**Files to create:**
- `frontend/src/components/DocumentUpload.tsx`
- `frontend/src/hooks/useDocumentStatus.ts`

- [ ] Create `frontend/src/hooks/useDocumentStatus.ts`:
  ```ts
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
      // Poll every 3s if any doc is pending/processing
      refetchInterval: (data) => {
        const hasActive = (data ?? []).some(
          (d) => d.status === 'pending' || d.status === 'processing'
        )
        return hasActive ? 3_000 : false
      },
    })
  }
  ```

- [ ] Create `frontend/src/components/DocumentUpload.tsx`:
  ```tsx
  import { useRef, useState } from 'react'
  import { useQueryClient } from '@tanstack/react-query'
  import { Upload, Loader2, CheckCircle2, XCircle, Trash2, FileText } from 'lucide-react'
  import { api } from '../api/client'
  import { useDocuments } from '../hooks/useDocumentStatus'
  import type { Document } from '../types'

  interface Props {
    teamId: string
  }

  const STATUS_ICON = {
    pending: <Loader2 size={12} className="animate-spin text-yellow-400" />,
    processing: <Loader2 size={12} className="animate-spin text-blue-400" />,
    ready: <CheckCircle2 size={12} className="text-green-400" />,
    failed: <XCircle size={12} className="text-red-400" />,
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  export default function DocumentUpload({ teamId }: Props) {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const queryClient = useQueryClient()
    const { data: documents = [] } = useDocuments(teamId)

    const upload = async (files: FileList | null) => {
      if (!files || files.length === 0) return
      setUploading(true)
      try {
        for (const file of Array.from(files)) {
          const form = new FormData()
          form.append('file', file)
          await api.post(`/documents/${teamId}/upload`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        }
        queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
      } catch (err) {
        console.error('Upload failed:', err)
      } finally {
        setUploading(false)
      }
    }

    const deleteDocument = async (doc: Document) => {
      await api.delete(`/documents/${teamId}/${doc.id}`)
      queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
    }

    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Documents</p>

        {/* Drop zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files) }}
          className={`border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-gray-700 hover:border-gray-600'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.csv"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          {uploading ? (
            <Loader2 size={18} className="animate-spin text-indigo-400 mx-auto" />
          ) : (
            <>
              <Upload size={18} className="text-gray-500 mx-auto mb-1" />
              <p className="text-xs text-gray-500">Drop files or click to upload</p>
              <p className="text-xs text-gray-600 mt-0.5">PDF, DOCX, TXT, CSV</p>
            </>
          )}
        </div>

        {/* Document list */}
        {documents.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/50 group"
              >
                <FileText size={12} className="text-gray-500 shrink-0" />
                <span className="flex-1 text-xs text-gray-300 truncate" title={doc.filename}>
                  {doc.filename}
                </span>
                <span className="text-xs text-gray-600 shrink-0">{formatSize(doc.file_size)}</span>
                {STATUS_ICON[doc.status]}
                <button
                  onClick={() => deleteDocument(doc)}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  ```

---

## Phase 5: Task Modes

### Task 7 — Mode selector and dynamic task forms

**Files to create:**
- `frontend/src/components/ModeSelector.tsx`
- `frontend/src/components/TaskForm.tsx`

- [ ] Create `frontend/src/components/ModeSelector.tsx`:
  ```tsx
  import { useQuery } from '@tanstack/react-query'
  import { api } from '../api/client'
  import type { TaskMode, Team } from '../types'

  interface Props {
    teamId: string
    onModeChange?: (mode: TaskMode | null) => void
  }

  export default function ModeSelector({ teamId, onModeChange }: Props) {
    // Get team's pack_id first, then fetch modes for that pack
    const { data: team } = useQuery<Team>({
      queryKey: ['team', teamId],
      queryFn: async () => {
        const res = await api.get('/auth/teams')
        return res.data.find((t: Team) => t.id === teamId) ?? null
      },
    })

    const { data: modes = [] } = useQuery<TaskMode[]>({
      queryKey: ['modes', team?.pack_id],
      enabled: !!team?.pack_id,
      queryFn: async () => {
        const res = await api.get(`/admin/packs/${team!.pack_id}/modes`)
        return res.data
      },
    })

    if (modes.length === 0) return null

    return (
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 px-1">
          Task Mode
        </label>
        <select
          onChange={(e) => {
            const mode = modes.find((m) => m.id === e.target.value) ?? null
            onModeChange?.(mode)
          }}
          defaultValue=""
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Default (no mode)</option>
          {modes.map((mode) => (
            <option key={mode.id} value={mode.id}>{mode.name}</option>
          ))}
        </select>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/components/TaskForm.tsx`:
  ```tsx
  import type { FormField } from '../types'

  interface Props {
    schema: Record<string, FormField>
    values: Record<string, string>
    onChange: (values: Record<string, string>) => void
  }

  export default function TaskForm({ schema, values, onChange }: Props) {
    const set = (key: string, val: string) => onChange({ ...values, [key]: val })

    return (
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Task Fields</p>
        {Object.entries(schema).map(([key, field]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              {field.label}
              {field.required && <span className="text-red-400 ml-1">*</span>}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                value={values[key] ?? ''}
                onChange={(e) => set(key, e.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            ) : field.type === 'select' ? (
              <select
                value={values[key] ?? ''}
                onChange={(e) => set(key, e.target.value)}
                required={field.required}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select…</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === 'number' ? 'number' : 'text'}
                value={values[key] ?? ''}
                onChange={(e) => set(key, e.target.value)}
                placeholder={field.placeholder}
                required={field.required}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            )}
          </div>
        ))}
      </div>
    )
  }
  ```

---

## Phase 6: Export

### Task 8 — Export button and dialog

**Files to create:**
- `frontend/src/components/ExportButton.tsx`
- `frontend/src/components/ExportDialog.tsx`

- [ ] Create `frontend/src/components/ExportDialog.tsx`:
  ```tsx
  import { useState } from 'react'
  import { X, Download, Loader2 } from 'lucide-react'
  import { getAccessToken } from '../api/client'

  interface Props {
    messageId?: string
    conversationId?: string
    onClose: () => void
  }

  export default function ExportDialog({ messageId, conversationId, onClose }: Props) {
    const [format, setFormat] = useState<'docx' | 'pdf'>('docx')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleExport = async () => {
      setLoading(true)
      setError(null)
      try {
        const endpoint = messageId
          ? `/api/export/message/${messageId}?format=${format}`
          : `/api/export/conversation/${conversationId}?format=${format}`

        const token = getAccessToken()
        const res = await fetch(endpoint, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!res.ok) throw new Error(`Export failed: ${res.status}`)

        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const filename = messageId
          ? `message.${format}`
          : `conversation.${format}`
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        onClose()
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-80 shadow-2xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Export</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          <p className="text-sm text-gray-400 mb-4">
            {messageId ? 'Export this message' : 'Export full conversation'}
          </p>

          <div className="space-y-2 mb-4">
            {(['docx', 'pdf'] as const).map((fmt) => (
              <label key={fmt} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="radio"
                  value={fmt}
                  checked={format === fmt}
                  onChange={() => setFormat(fmt)}
                  className="accent-indigo-500"
                />
                <span className="text-sm text-gray-300">
                  {fmt === 'docx' ? 'Word Document (.docx)' : 'PDF (.pdf)'}
                </span>
              </label>
            ))}
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-3">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Download
            </button>
          </div>
        </div>
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/components/ExportButton.tsx`:
  ```tsx
  import { useState } from 'react'
  import { Download } from 'lucide-react'
  import ExportDialog from './ExportDialog'

  interface Props {
    messageId?: string
    conversationId?: string
    label?: string
  }

  export default function ExportButton({ messageId, conversationId, label }: Props) {
    const [open, setOpen] = useState(false)

    return (
      <>
        <button
          onClick={() => setOpen(true)}
          title="Export"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded hover:bg-gray-800"
        >
          <Download size={12} />
          {label && <span>{label}</span>}
        </button>
        {open && (
          <ExportDialog
            messageId={messageId}
            conversationId={conversationId}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    )
  }
  ```

---

## Phase 7: Admin

### Task 9 — Admin layout and routing

**Files to create:**
- `frontend/src/pages/admin/AdminLayout.tsx`

- [ ] Create `frontend/src/pages/admin/AdminLayout.tsx`:
  ```tsx
  import { NavLink, Outlet } from 'react-router-dom'
  import { Package, Sliders, Users, Building2, ChevronLeft } from 'lucide-react'
  import { Link } from 'react-router-dom'

  const NAV = [
    { to: '/admin/packs', label: 'Prompt Packs', icon: Package },
    { to: '/admin/teams', label: 'Teams', icon: Building2 },
    { to: '/admin/users', label: 'Users', icon: Users },
  ]

  export default function AdminLayout() {
    return (
      <div className="flex h-screen bg-gray-950 text-gray-100">
        <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
          <div className="p-4 border-b border-gray-800">
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
            >
              <ChevronLeft size={16} />
              Back to Chat
            </Link>
          </div>
          <div className="p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 mb-2">
              Admin
            </p>
            <nav className="space-y-0.5">
              {NAV.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-600/20 text-indigo-300'
                        : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    )
  }
  ```

---

### Task 10 — Pack management page

**Files to create:**
- `frontend/src/pages/admin/AdminPacks.tsx`

- [ ] Create `frontend/src/pages/admin/AdminPacks.tsx`:
  ```tsx
  import { useState, useRef } from 'react'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { Link } from 'react-router-dom'
  import { Plus, Upload, Download, Sliders, Trash2, Loader2 } from 'lucide-react'
  import { api } from '../../api/client'
  import { getAccessToken } from '../../api/client'
  import type { PromptPack } from '../../types'

  export default function AdminPacks() {
    const qc = useQueryClient()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newDesc, setNewDesc] = useState('')

    const { data: packs = [], isLoading } = useQuery<PromptPack[]>({
      queryKey: ['admin', 'packs'],
      queryFn: async () => (await api.get('/admin/packs')).data,
    })

    const createPack = useMutation({
      mutationFn: (body: { name: string; description: string }) =>
        api.post('/admin/packs', { ...body, version: '1.0.0' }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
        setCreating(false)
        setNewName('')
        setNewDesc('')
      },
    })

    const importPack = async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      form.append('name', file.name.replace('.zip', ''))
      await api.post('/admin/packs/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      qc.invalidateQueries({ queryKey: ['admin', 'packs'] })
    }

    const exportPack = async (pack: PromptPack) => {
      const token = getAccessToken()
      const res = await fetch(`/api/admin/packs/${pack.id}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${pack.name}.zip`
      a.click()
      URL.revokeObjectURL(url)
    }

    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Prompt Packs</h1>
            <p className="text-sm text-gray-400 mt-1">
              Manage prompt instruction packs and their modules
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && importPack(e.target.files[0])}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors"
            >
              <Upload size={16} />
              Import ZIP
            </button>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              New Pack
            </button>
          </div>
        </div>

        {creating && (
          <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">New Pack</h3>
            <input
              type="text"
              placeholder="Pack name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => createPack.mutate({ name: newName, description: newDesc })}
                disabled={!newName || createPack.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {createPack.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-gray-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {packs.map((pack) => (
              <div
                key={pack.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white">{pack.name}</h3>
                      <span className="text-xs text-gray-500 bg-gray-800 rounded px-1.5 py-0.5">
                        v{pack.version}
                      </span>
                      <span className="text-xs text-gray-500">
                        {pack.module_count} modules
                      </span>
                    </div>
                    {pack.description && (
                      <p className="text-sm text-gray-400 mt-1">{pack.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/admin/packs/${pack.id}/modes`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                    >
                      <Sliders size={14} />
                      Modes
                    </Link>
                    <button
                      onClick={() => exportPack(pack)}
                      className="p-1.5 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                      title="Export ZIP"
                    >
                      <Download size={16} />
                    </button>
                  </div>
                </div>
                {/* Module editor inline */}
                <PackModules packId={pack.id} />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  function PackModules({ packId }: { packId: string }) {
    const [expanded, setExpanded] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const qc = useQueryClient()

    const { data: modules = [] } = useQuery({
      queryKey: ['admin', 'modules', packId],
      enabled: expanded,
      queryFn: async () => (await api.get(`/admin/packs/${packId}/modules`)).data,
    })

    const updateModule = useMutation({
      mutationFn: ({ id, body }: any) => api.put(`/admin/modules/${id}`, body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'modules', packId] })
        setEditingId(null)
      },
    })

    return (
      <div className="mt-3 border-t border-gray-800 pt-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          {expanded ? 'Hide modules' : 'Show modules'}
        </button>
        {expanded && (
          <div className="mt-2 space-y-1">
            {modules.map((mod: any) => (
              <ModuleRow
                key={mod.id}
                module={mod}
                isEditing={editingId === mod.id}
                onEdit={() => setEditingId(mod.id)}
                onCancel={() => setEditingId(null)}
                onSave={(body) => updateModule.mutate({ id: mod.id, body })}
                saving={updateModule.isPending}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  function ModuleRow({ module, isEditing, onEdit, onCancel, onSave, saving }: any) {
    const [content, setContent] = useState(module.content)
    const [title, setTitle] = useState(module.title)
    const [tags, setTags] = useState((module.tags ?? []).join(', '))
    const [layer, setLayer] = useState(module.layer)
    const [priority, setPriority] = useState(module.priority)

    const LAYER_COLOR: Record<string, string> = {
      core: 'text-blue-400 bg-blue-900/30',
      always: 'text-purple-400 bg-purple-900/30',
      domain: 'text-green-400 bg-green-900/30',
    }

    if (!isEditing) {
      return (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-800/50 cursor-pointer group"
          onClick={onEdit}
        >
          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${LAYER_COLOR[module.layer] ?? ''}`}>
            {module.layer}
          </span>
          <span className="text-sm text-gray-300 truncate flex-1">{module.filename}</span>
          <span className="text-xs text-gray-500">{module.token_count} tok</span>
          <span className="text-xs text-indigo-400 opacity-0 group-hover:opacity-100">Edit</span>
        </div>
      )
    }

    return (
      <div className="border border-indigo-700/50 rounded-xl p-4 bg-gray-900/80 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Layer</label>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
            >
              <option value="core">core</option>
              <option value="always">always</option>
              <option value="domain">domain</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Priority</label>
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Tags (comma-separated)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Content (Markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              onSave({
                filename: module.filename,
                title,
                layer,
                tags: tags.split(',').map((t: string) => t.trim()).filter(Boolean),
                priority,
                content,
                sort_order: module.sort_order,
              })
            }
            disabled={saving}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-xs font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }
  ```

---

### Task 11 — Task modes admin page

**Files to create:**
- `frontend/src/pages/admin/AdminModes.tsx`

- [ ] Create `frontend/src/pages/admin/AdminModes.tsx`:
  ```tsx
  import { useState } from 'react'
  import { useParams } from 'react-router-dom'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { Plus, Trash2, Loader2 } from 'lucide-react'
  import { api } from '../../api/client'
  import type { TaskMode } from '../../types'

  export default function AdminModes() {
    const { packId } = useParams<{ packId: string }>()
    const qc = useQueryClient()
    const [creating, setCreating] = useState(false)
    const [form, setForm] = useState({ name: '', prompt_text: '', form_schema: '' })
    const [schemaError, setSchemaError] = useState<string | null>(null)

    const { data: modes = [], isLoading } = useQuery<TaskMode[]>({
      queryKey: ['admin', 'modes', packId],
      enabled: !!packId,
      queryFn: async () => (await api.get(`/admin/packs/${packId}/modes`)).data,
    })

    const createMode = useMutation({
      mutationFn: (body: any) => api.post(`/admin/packs/${packId}/modes`, body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'modes', packId] })
        setCreating(false)
        setForm({ name: '', prompt_text: '', form_schema: '' })
      },
    })

    const deleteMode = useMutation({
      mutationFn: (id: string) => api.delete(`/admin/modes/${id}`),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'modes', packId] }),
    })

    const handleCreate = () => {
      setSchemaError(null)
      let parsedSchema = null
      if (form.form_schema.trim()) {
        try {
          parsedSchema = JSON.parse(form.form_schema)
        } catch {
          setSchemaError('Invalid JSON in form schema')
          return
        }
      }
      createMode.mutate({
        name: form.name,
        prompt_text: form.prompt_text,
        form_schema: parsedSchema,
        sort_order: modes.length,
      })
    }

    return (
      <div className="p-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Task Modes</h1>
            <p className="text-sm text-gray-400 mt-1">
              Define structured input modes for pack {packId?.slice(0, 8)}…
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Mode
          </button>
        </div>

        {creating && (
          <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">New Task Mode</h3>
            <input
              type="text"
              placeholder="Mode name (e.g. tender_response)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              placeholder="Prompt text appended to system prompt when this mode is active…"
              value={form.prompt_text}
              onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
              rows={5}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none font-mono"
            />
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Form Schema (JSON, optional) — defines input fields shown to users
              </label>
              <textarea
                placeholder={`{\n  "project_name": { "type": "text", "label": "Project Name", "required": true },\n  "scope": { "type": "textarea", "label": "Scope Description" }\n}`}
                value={form.form_schema}
                onChange={(e) => setForm({ ...form, form_schema: e.target.value })}
                rows={6}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-none"
              />
              {schemaError && <p className="text-xs text-red-400 mt-1">{schemaError}</p>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!form.name || !form.prompt_text || createMode.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {createMode.isPending ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-gray-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {modes.map((mode) => (
              <div key={mode.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-white">{mode.name}</h3>
                  <button
                    onClick={() => deleteMode.mutate(mode.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 font-mono bg-gray-800 rounded p-2 mb-2 whitespace-pre-wrap line-clamp-3">
                  {mode.prompt_text}
                </p>
                {mode.form_schema && (
                  <div className="text-xs text-gray-500">
                    Form fields: {Object.keys(mode.form_schema).join(', ')}
                  </div>
                )}
              </div>
            ))}
            {modes.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">No modes defined yet</p>
            )}
          </div>
        )}
      </div>
    )
  }
  ```

---

### Task 12 — Teams and users admin pages

**Files to create:**
- `frontend/src/pages/admin/AdminTeams.tsx`
- `frontend/src/pages/admin/AdminUsers.tsx`

- [ ] Create `frontend/src/pages/admin/AdminTeams.tsx`:
  ```tsx
  import { useState } from 'react'
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
  import { Loader2, Plus, Link as LinkIcon } from 'lucide-react'
  import { api } from '../../api/client'
  import type { Team, PromptPack } from '../../types'

  export default function AdminTeams() {
    const qc = useQueryClient()
    const [creating, setCreating] = useState(false)
    const [form, setForm] = useState({ name: '', description: '' })
    const [inviteToken, setInviteToken] = useState<{ teamId: string; token: string } | null>(null)

    const { data: teams = [], isLoading: teamsLoading } = useQuery<Team[]>({
      queryKey: ['admin', 'teams'],
      queryFn: async () => (await api.get('/auth/teams')).data,
    })

    const { data: packs = [] } = useQuery<PromptPack[]>({
      queryKey: ['admin', 'packs'],
      queryFn: async () => (await api.get('/admin/packs')).data,
    })

    const createTeam = useMutation({
      mutationFn: (body: { name: string; description: string }) =>
        api.post('/auth/teams', body),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['admin', 'teams'] })
        setCreating(false)
        setForm({ name: '', description: '' })
      },
    })

    const assignPack = useMutation({
      mutationFn: ({ teamId, packId }: { teamId: string; packId: string }) =>
        api.put(`/admin/teams/${teamId}/pack`, null, { params: { pack_id: packId } }),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'teams'] }),
    })

    const generateInvite = async (teamId: string) => {
      const res = await api.post(`/auth/teams/${teamId}/invite`, { expire_hours: 72 })
      setInviteToken({ teamId, token: res.data.invite_token })
    }

    const inviteUrl = inviteToken
      ? `${window.location.origin}/invite/${inviteToken.token}`
      : null

    return (
      <div className="p-8 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Teams</h1>
            <p className="text-sm text-gray-400 mt-1">Manage teams and pack assignments</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            New Team
          </button>
        </div>

        {inviteUrl && (
          <div className="mb-6 p-4 bg-indigo-900/30 border border-indigo-700/50 rounded-xl">
            <p className="text-sm font-medium text-indigo-300 mb-2">Invite link generated (72h)</p>
            <div className="flex gap-2">
              <code className="flex-1 text-xs text-indigo-200 bg-indigo-900/40 rounded px-3 py-2 break-all">
                {inviteUrl}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(inviteUrl); }}
                className="px-3 py-2 bg-indigo-700 hover:bg-indigo-600 rounded-lg text-xs text-white transition-colors shrink-0"
              >
                Copy
              </button>
            </div>
            <button
              onClick={() => setInviteToken(null)}
              className="mt-2 text-xs text-gray-500 hover:text-gray-400"
            >
              Dismiss
            </button>
          </div>
        )}

        {creating && (
          <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
            <h3 className="text-sm font-semibold text-white">New Team</h3>
            <input
              type="text"
              placeholder="Team name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex gap-2">
              <button
                onClick={() => createTeam.mutate(form)}
                disabled={!form.name || createTeam.isPending}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
              >
                {createTeam.isPending ? 'Creating…' : 'Create'}
              </button>
              <button onClick={() => setCreating(false)} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {teamsLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-500" /></div>
        ) : (
          <div className="space-y-3">
            {teams.map((team) => (
              <div key={team.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white">{team.name}</h3>
                    {team.description && (
                      <p className="text-sm text-gray-400">{team.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => generateInvite(team.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <LinkIcon size={14} />
                    Invite Link
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400 shrink-0">Prompt Pack:</label>
                  <select
                    value={team.pack_id ?? ''}
                    onChange={(e) => assignPack.mutate({ teamId: team.id, packId: e.target.value })}
                    className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">None</option>
                    {packs.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {teams.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-8">No teams yet</p>
            )}
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] Create `frontend/src/pages/admin/AdminUsers.tsx`:
  ```tsx
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
  ```

---

## Phase 8: Polish

### Task 13 — Loading states, error boundaries, and responsive layout

**Files to create:**
- `frontend/src/components/ErrorBoundary.tsx`
- `frontend/src/components/Spinner.tsx`

- [ ] Create `frontend/src/components/Spinner.tsx`:
  ```tsx
  interface Props {
    size?: 'sm' | 'md' | 'lg'
    className?: string
  }

  const SIZES = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' }

  export default function Spinner({ size = 'md', className = '' }: Props) {
    return (
      <div
        className={`${SIZES[size]} border-2 border-indigo-500 border-t-transparent rounded-full animate-spin ${className}`}
      />
    )
  }
  ```

- [ ] Create `frontend/src/components/ErrorBoundary.tsx`:
  ```tsx
  import React from 'react'

  interface State { hasError: boolean; error: Error | null }

  export default class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    State
  > {
    constructor(props: any) {
      super(props)
      this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
      return { hasError: true, error }
    }

    render() {
      if (this.state.hasError) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-950">
            <div className="text-center max-w-md p-8">
              <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
              <p className="text-sm text-gray-400 mb-4">{this.state.error?.message}</p>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm text-white transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        )
      }
      return this.props.children
    }
  }
  ```

- [ ] Wrap App with ErrorBoundary in `frontend/src/main.tsx` — update the render call:
  ```tsx
  import ErrorBoundary from './components/ErrorBoundary'

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
  ```

- [ ] Add Tailwind Typography plugin for prose markdown rendering:
  ```bash
  npm install @tailwindcss/typography
  ```
  Update `frontend/src/index.css`:
  ```css
  @import "tailwindcss";
  @plugin "@tailwindcss/typography";
  ```

---

### Task 14 — Invite acceptance page and Dockerfile

**Files to create:**
- `frontend/src/pages/InvitePage.tsx`
- `frontend/Dockerfile`

- [ ] Create `frontend/src/pages/InvitePage.tsx`:
  ```tsx
  import { useEffect, useState } from 'react'
  import { useParams, useNavigate } from 'react-router-dom'
  import { api } from '../api/client'
  import { useAuth } from '../contexts/AuthContext'
  import Spinner from '../components/Spinner'

  export default function InvitePage() {
    const { token } = useParams<{ token: string }>()
    const { user } = useAuth()
    const navigate = useNavigate()
    const [status, setStatus] = useState<'idle' | 'accepting' | 'done' | 'error'>('idle')
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      if (!token) return
      if (!user) {
        // Store invite token and redirect to login
        sessionStorage.setItem('pending_invite', token)
        navigate('/login')
        return
      }
      // Accept automatically once logged in
      const accept = async () => {
        setStatus('accepting')
        try {
          await api.post(`/auth/invite/${token}/accept`)
          setStatus('done')
          setTimeout(() => navigate('/'), 2000)
        } catch (err: any) {
          setError(err.response?.data?.detail ?? 'Failed to accept invite')
          setStatus('error')
        }
      }
      accept()
    }, [token, user])

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-sm p-8">
          {status === 'accepting' && (
            <>
              <Spinner size="lg" className="mx-auto mb-4" />
              <p className="text-white">Joining team…</p>
            </>
          )}
          {status === 'done' && (
            <>
              <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-white text-xl">✓</span>
              </div>
              <p className="text-white font-semibold">Team joined!</p>
              <p className="text-gray-400 text-sm mt-1">Redirecting to chat…</p>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-red-400 font-semibold">Invite failed</p>
              <p className="text-gray-400 text-sm mt-1">{error}</p>
            </>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] Add invite route to `frontend/src/App.tsx` inside the Routes block:
  ```tsx
  <Route path="/invite/:token" element={<InvitePage />} />
  ```

- [ ] Create `frontend/Dockerfile`:
  ```dockerfile
  # Build stage
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build

  # Serve via nginx
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]
  ```

- [ ] Create `frontend/nginx.conf`:
  ```nginx
  server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to backend
    location /api/ {
      proxy_pass http://api:8000;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      # SSE support
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 600s;
    }
  }
  ```

---

### Task 15 — Verify dev server runs end-to-end

- [ ] Start backend (from `promptbase/backend/`):
  ```bash
  uvicorn app.main:app --reload --port 8000
  ```

- [ ] Start frontend dev server (from `promptbase/frontend/`):
  ```bash
  npm run dev
  ```

- [ ] Open `http://localhost:5173` and verify:
  - [ ] Register page renders and creates a user
  - [ ] Login page signs in and redirects to `/`
  - [ ] Chat page shows team selector in sidebar
  - [ ] Document upload drop zone appears
  - [ ] Sending a message triggers SSE stream and tokens appear in real time
  - [ ] Export button on message opens dialog and downloads `.docx`
  - [ ] Admin link appears in sidebar for super admin users
  - [ ] Admin packs page lists packs, module editor opens inline
  - [ ] Teams page assigns packs and generates invite links

- [ ] Build for production:
  ```bash
  npm run build
  ```
  Confirm `dist/` is generated with no TypeScript errors.

---

## Directory Structure Summary

```
promptbase/frontend/
├── Dockerfile
├── nginx.conf
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── api/
    │   └── client.ts
    ├── types/
    │   └── index.ts
    ├── contexts/
    │   └── AuthContext.tsx
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useSSE.ts
    │   └── useDocumentStatus.ts
    ├── components/
    │   ├── ChatMessage.tsx
    │   ├── ChatInput.tsx
    │   ├── ChatMain.tsx
    │   ├── ChatSidebar.tsx
    │   ├── ConversationList.tsx
    │   ├── DocumentUpload.tsx
    │   ├── ErrorBoundary.tsx
    │   ├── ExportButton.tsx
    │   ├── ExportDialog.tsx
    │   ├── ModeSelector.tsx
    │   ├── ProtectedRoute.tsx
    │   ├── Spinner.tsx
    │   └── TaskForm.tsx
    └── pages/
        ├── ChatPage.tsx
        ├── LoginPage.tsx
        ├── RegisterPage.tsx
        ├── InvitePage.tsx
        └── admin/
            ├── AdminLayout.tsx
            ├── AdminModes.tsx
            ├── AdminPacks.tsx
            ├── AdminTeams.tsx
            └── AdminUsers.tsx
```
