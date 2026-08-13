import { useState } from 'react'
import { API_BASE } from '../App'

export default function LoginPage({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI

  const handlePopupLogin = async () => {
    if (!isElectron) {
      setError('Popup login requires the desktop app. Use Token login instead.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const captured = await window.electronAPI?.openOAuth(
        'https://play.qobuz.com/login',
      )
      if (captured) {
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
      <div className="w-full max-w-[400px] text-center animate-fade-in">
        <h1 className="text-[36px] font-extrabold tracking-[-0.5px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent mb-1">
          Qrip
        </h1>
        <p className="text-base text-text-muted mb-8">Sign in to start downloading</p>

        {/* Primary: popup login */}
        <button
          onClick={handlePopupLogin}
          disabled={loading}
          className="w-full h-[52px] bg-purple text-white rounded-xl text-lg font-semibold flex items-center justify-center gap-2.5 hover:bg-[#6d28d9] transition disabled:opacity-50 shadow-[0_4px_20px_rgba(124,58,237,0.35)]"
        >
          <span className="text-xl">🎵</span>
          {loading ? 'Opening...' : '登录 Qobuz'}
        </button>
        <p className="text-sm text-text-muted mt-3">
          {isElectron
            ? '弹出 Qobuz 登录窗口，登录后自动完成认证'
            : '弹窗登录仅在桌面 App 中可用，请使用下方 Token 登录'}
        </p>

        {/* Divider */}
        <div className="flex items-center gap-3 my-7">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-text-muted">或</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Secondary: token login */}
        {!showToken ? (
          <button
            onClick={() => setShowToken(true)}
            className="text-sm text-text-secondary hover:text-purple-light transition"
          >
            使用 Token 登录 ▾
          </button>
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in text-left">
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="粘贴你的 Qobuz auth token..."
              className="w-full h-24 bg-bg-input border border-border rounded-lg px-3 py-2.5 text-base text-text-primary placeholder:text-text-muted outline-none focus:border-purple transition resize-none"
            />
            <button
              onClick={handleTokenLogin}
              disabled={loading || !token.trim()}
              className="w-full h-[46px] bg-bg-input border border-border text-text-primary rounded-lg text-base font-medium hover:border-purple hover:text-purple-light transition disabled:opacity-50"
            >
              {loading ? 'Authenticating...' : 'Token 认证'}
            </button>
          </div>
        )}

        {error && <p className="text-red-500 text-base mt-4 animate-fade-in">{error}</p>}
      </div>
    </div>
  )
}
