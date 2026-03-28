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
