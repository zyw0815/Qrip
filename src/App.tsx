import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import MainLayout from './pages/MainLayout'
import { LanguageProvider, useI18n } from './i18n'

export const API_BASE = 'http://127.0.0.1:8000'

export default function App() {
  return (
    <LanguageProvider>
      <AppInner />
    </LanguageProvider>
  )
}

function AppInner() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    let retries = 0
    let stopped = false
    const check = () => {
      fetch(`${API_BASE}/auth/status`)
        .then((r) => r.json())
        .then((d) => { if (!stopped) setIsAuthenticated(d.authenticated) })
        .catch(() => {
          if (stopped) return
          retries++
          // The packaged backend (PyInstaller onefile) can take a while on
          // cold start, and a leftover orphan backend can delay things
          // further — keep trying for 60s before falling back to the login
          // page (which self-heals via the poll below).
          if (retries < 120) setTimeout(check, 500)
          else setIsAuthenticated(false)
        })
    }
    check()
    return () => { stopped = true }
  }, [])

  // Self-heal: if the login page is showing but the backend later reports
  // authenticated (e.g. it was just slow to start), jump straight in.
  useEffect(() => {
    if (isAuthenticated !== false) return
    const timer = setInterval(() => {
      fetch(`${API_BASE}/auth/status`)
        .then((r) => r.json())
        .then((d) => { if (d.authenticated) setIsAuthenticated(true) })
        .catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [isAuthenticated])

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-bg-deep flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <h1 className="text-[32px] font-extrabold tracking-[-0.5px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent mb-3">
            Qrip
          </h1>
          <p className="text-lg text-text-muted">{t('app.starting')}</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <LoginPage onAuthSuccess={() => setIsAuthenticated(true)} />
  }

  return <MainLayout />
}
