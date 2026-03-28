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
