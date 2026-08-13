import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import MainLayout from './pages/MainLayout'

export const API_BASE = 'http://127.0.0.1:8000'

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    let retries = 0
    const check = () => {
      fetch(`${API_BASE}/auth/status`)
        .then((r) => r.json())
        .then((d) => setIsAuthenticated(d.authenticated))
        .catch(() => {
          if (retries < 20) {
            retries++
            setTimeout(check, 500)
          } else {
            setIsAuthenticated(false)
          }
        })
    }
    check()
  }, [])

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-bg-deep flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <h1 className="text-[32px] font-extrabold tracking-[-0.5px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent mb-3">
            Qrip
          </h1>
          <p className="text-lg text-text-muted">Starting up…</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage onAuthSuccess={() => setIsAuthenticated(true)} />
  }

  return <MainLayout />
}
