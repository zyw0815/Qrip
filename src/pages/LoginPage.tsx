import { useState } from 'react'
import { API_BASE } from '../App'

export default function LoginPage({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGoogleLogin = async () => {
    try {
      const capturedToken = await window.electronAPI?.openOAuth(
        'https://play.qobuz.com/login?open-oauth=google',
      )
      if (capturedToken) {
        setLoading(true)
        setError('')
        const r = await fetch(
          `${API_BASE}/auth/login/google?token=${encodeURIComponent(capturedToken)}`,
          { method: 'POST' },
        )
        if (r.ok) onAuthSuccess()
        else {
          const data = await r.json()
          setError(data.detail || 'Login failed')
        }
      } else {
        setError('Login window closed without completing sign-in')
      }
    } catch {
      setError('Login failed. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const bgStyle = {
    backgroundImage:
      'radial-gradient(ellipse at 30% 0%, rgba(124,58,237,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 100%, rgba(124,58,237,0.04) 0%, transparent 60%)',
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={bgStyle}>
      <div className="w-full max-w-[380px] text-center animate-fade-in">
        <h1 className="text-[32px] font-extrabold tracking-[-0.5px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent mb-1">
          Qrip
        </h1>
        <p className="text-xs text-text-muted mb-7">Sign in to start downloading</p>

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full h-11 bg-[#4285f4] text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-50"
        >
          <span className="bg-white text-[#4285f4] w-5 h-5 rounded-full text-xs font-bold leading-5">
            G
          </span>
          {loading ? 'Signing in...' : 'Sign in with Google'}
        </button>
        <p className="text-[10px] text-text-muted mt-2.5">
          Opens a secure browser for Google authentication
        </p>

        {error && <p className="text-red-500 text-xs mt-4 animate-fade-in">{error}</p>}
      </div>
    </div>
  )
}
