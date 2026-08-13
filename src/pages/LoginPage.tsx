import { useState } from 'react'
import { API_BASE } from '../App'

type LoginMethod = 'google' | 'email' | 'token'

export default function LoginPage({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [method, setMethod] = useState<LoginMethod>('google')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  const handleGoogleLogin = async () => {
    if (!isElectron) {
      setError('Google login requires the desktop app. Use Email or Token in browser.')
      return
    }
    try {
      const captured = await window.electronAPI?.openOAuth(
        'https://play.qobuz.com/login?open-oauth=google',
      )
      if (captured) {
        setLoading(true)
        setError('')
        let userId = ''
        let token = ''
        try {
          const parsed = JSON.parse(captured)
          userId = parsed.userId || ''
          token = parsed.token || ''
        } catch {
          // Old format: raw token string
          token = captured
        }
        const r = await fetch(`${API_BASE}/auth/login/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, token }),
        })
        if (r.ok) onAuthSuccess()
        else {
          const data = await r.json()
          setError(data.detail || 'Login failed')
        }
      } else {
        setError('OAuth window closed without completing login')
      }
    } catch {
      setError('OAuth flow failed')
    } finally {
      setLoading(false)
    }
  }

  const handleEmailLogin = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/login/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (r.ok) onAuthSuccess()
      else {
        const data = await r.json()
        setError(data.detail || 'Login failed')
      }
    } catch {
      setError('Connection failed. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const handleTokenLogin = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/auth/login/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (r.ok) onAuthSuccess()
      else {
        const data = await r.json()
        setError(data.detail || 'Invalid token')
      }
    } catch {
      setError('Connection failed. Is the backend running?')
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
        <p className="text-sm text-text-muted mb-7">Sign in to start downloading</p>

        {/* Method tabs */}
        <div className="flex border-b border-border mb-5">
          {(
            [
              ['google', 'Google'],
              ['email', 'Email'],
              ['token', 'Token'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setMethod(key); setError('') }}
              className={`flex-1 text-center py-2.5 text-sm font-medium border-b-2 transition-colors ${
                method === key
                  ? 'text-purple-light border-purple'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Google */}
        {method === 'google' && (
          <div className="animate-fade-in">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full h-11 bg-[#4285f4] text-white rounded-lg text-base font-medium flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-50"
            >
              <span className="bg-white text-[#4285f4] w-5 h-5 rounded-full text-sm font-bold leading-5">
                G
              </span>
              Sign in with Google
            </button>
            {!isElectron && (
              <p className="text-[12px] text-yellow-500/70 mt-2">
                Google login is only available in the desktop app
              </p>
            )}
            {isElectron && (
              <p className="text-[12px] text-text-muted mt-2.5">
                Opens a secure browser for Google authentication
              </p>
            )}
          </div>
        )}

        {/* Email */}
        {method === 'email' && (
          <div className="flex flex-col gap-2.5 animate-fade-in">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full h-[42px] bg-bg-input border border-border rounded-lg px-3 text-base text-text-primary placeholder:text-text-muted outline-none focus:border-purple transition"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full h-[42px] bg-bg-input border border-border rounded-lg px-3 text-base text-text-primary placeholder:text-text-muted outline-none focus:border-purple transition"
            />
            <button
              onClick={handleEmailLogin}
              disabled={loading || !email || !password}
              className="w-full h-[42px] bg-purple text-white rounded-lg text-base font-medium hover:bg-[#6d28d9] transition disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in with Email'}
            </button>
          </div>
        )}

        {/* Token */}
        {method === 'token' && (
          <div className="flex flex-col gap-2.5 animate-fade-in">
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste your Qobuz auth token..."
              className="w-full h-20 bg-bg-input border border-border rounded-lg px-3 py-2.5 text-base text-text-primary placeholder:text-text-muted outline-none focus:border-purple transition resize-none"
            />
            <button
              onClick={handleTokenLogin}
              disabled={loading || !token.trim()}
              className="w-full h-[42px] bg-purple text-white rounded-lg text-base font-medium hover:bg-[#6d28d9] transition disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Authenticate with Token'}
            </button>
          </div>
        )}

        {error && <p className="text-red-500 text-sm mt-4 animate-fade-in">{error}</p>}
      </div>
    </div>
  )
}
