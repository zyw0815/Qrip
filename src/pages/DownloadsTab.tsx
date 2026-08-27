import { useState, useEffect } from 'react'
import ProgressBar from '../components/ProgressBar'
import { API_BASE } from '../App'
import { useI18n } from '../i18n'

interface DownloadItem {
  item_id: string
  name: string
  album: string
  downloaded: number
  total: number
  speed: string
  status: 'downloading' | 'queued' | 'paused' | 'completed' | 'failed'
  paused?: boolean
  error?: string
}

export default function DownloadsTab() {
  const { t } = useI18n()
  const [downloading, setDownloading] = useState<DownloadItem[]>([])
  const [queued, setQueued] = useState<DownloadItem[]>([])
  const [failed, setFailed] = useState<DownloadItem[]>([])
  const [completed, setCompleted] = useState<DownloadItem[]>([])
  const [deleteFilesOnClear, setDeleteFilesOnClear] = useState(false)

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/download/status`)
        const data = await r.json()
        setDownloading(data.downloading || [])
        setQueued(data.queue || [])
        setFailed(data.failed || [])
        setCompleted(data.completed || [])
      } catch {
        // backend might not be ready yet
      }
    }
    poll()
    const interval = setInterval(poll, 1000)
    return () => clearInterval(interval)
  }, [])

  const pause = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/pause`, { method: 'POST' })
  }
  const resume = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/resume`, { method: 'POST' })
  }
  const cancel = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/cancel`, { method: 'POST' })
  }
  const retry = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/retry`, { method: 'POST' })
  }
  const clearCompleted = async () => {
    await fetch(`${API_BASE}/download/completed/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete_files: deleteFilesOnClear }),
    }).catch(() => {})
    setCompleted([])
  }

  if (downloading.length === 0 && queued.length === 0 && failed.length === 0 && completed.length === 0) {
    return (
      <div className="p-5 animate-fade-in h-full">
        <div className="text-center py-24">
          <p className="text-5xl mb-5 opacity-40">⬇</p>
          <p className="text-text-muted text-lg font-medium">{t('dl.empty')}</p>
          <p className="text-text-muted/50 text-base mt-2">
            {t('dl.emptyHint')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 animate-fade-in h-full">
      {/* Active downloads */}
      {downloading.length > 0 && (
        <>
          <p className="text-base text-text-muted tracking-wider mb-2.5 font-semibold uppercase">
            {t('dl.downloading', { n: downloading.length })}
          </p>
          {downloading.map((d) => (
            <div
              key={d.item_id}
              className="bg-bg-card/40 border border-border rounded-xl p-4 mb-2.5 hover:border-purple/25 transition"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-lg text-text-primary font-medium truncate mr-2">
                  {d.name}
                </span>
                <span className="text-lg text-purple-light flex-shrink-0 font-medium">
                  {d.total > 0 ? `${d.downloaded} MB / ${d.total} MB` : `${d.downloaded} MB`}
                </span>
              </div>
              <ProgressBar
                percent={d.total > 0 ? (d.downloaded / d.total) * 100 : 0}
              />
              <div className="flex justify-between mt-2.5 items-center">
                <span className="text-base text-text-muted">
                  {d.paused ? t('dl.pausedLabel') : `${d.speed} MB/s`}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => (d.paused ? resume(d.item_id) : pause(d.item_id))}
                    className="h-9 px-3.5 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-purple hover:text-purple-light transition select-none"
                  >
                    {d.paused ? t('dl.resume') : t('dl.pause')}
                  </button>
                  <button
                    onClick={() => cancel(d.item_id)}
                    className="h-9 px-3.5 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-red-500 hover:text-red-400 transition select-none"
                  >
                    {t('dl.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Queued */}
      {queued.length > 0 && (
        <>
          <p className="text-base text-text-muted tracking-wider mb-2.5 mt-5 font-semibold uppercase">
            {t('dl.queued')}
          </p>
          {queued.map((q, i) => (
            <div
              key={q.item_id}
              className="bg-bg-card/20 border border-border rounded-xl px-4 py-3.5 mb-2 flex items-center gap-3"
            >
              <span className="text-lg flex-shrink-0">⏳</span>
              <div className="flex-1 min-w-0">
                <div className="text-lg text-text-primary truncate">{q.name}</div>
                <div className="text-base text-text-muted truncate mt-0.5">{q.album}</div>
              </div>
              <span className="text-base text-text-muted flex-shrink-0">
                #{downloading.length + i + 1}
              </span>
              <button
                onClick={() => cancel(q.item_id)}
                className="h-9 px-3 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-red-500 hover:text-red-400 transition flex-shrink-0"
              >
                {t('dl.delete')}
              </button>
            </div>
          ))}
        </>
      )}
      {/* Failed — shown with the reason so failures are never silent */}
      {failed.length > 0 && (
        <>
          <p className="text-base text-text-muted tracking-wider mb-2.5 mt-5 font-semibold uppercase">
            {t('dl.failed')}
          </p>
          {failed.map((f) => (
            <div
              key={f.item_id}
              className="bg-bg-card/20 border border-red-500/30 rounded-xl px-4 py-3.5 mb-2 flex items-center gap-3"
            >
              <span className="text-lg flex-shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <div className="text-lg text-text-primary truncate">{f.name}</div>
                <div className="text-base text-red-400/90 truncate mt-0.5">
                  {f.error || t('dl.failed')}
                </div>
              </div>
              <button
                onClick={() => retry(f.item_id)}
                className="h-9 px-3.5 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-purple hover:text-purple-light transition flex-shrink-0"
              >
                {t('dl.retry')}
              </button>
            </div>
          ))}
        </>
      )}

      {/* Completed (this session) */}
      {completed.length > 0 && (
        <>
          <div className="flex justify-between items-center mb-2.5 mt-5">
            <p className="text-base text-text-muted tracking-wider font-semibold uppercase">
              {t('dl.completed')}
            </p>
            <div className="flex items-center gap-2.5">
              <label className="flex items-center gap-1.5 text-[13px] text-text-muted select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteFilesOnClear}
                  onChange={(e) => setDeleteFilesOnClear(e.target.checked)}
                  className="w-3.5 h-3.5 accent-purple cursor-pointer"
                />
                {t('dl.deleteFilesToo')}
              </label>
              <button
                onClick={clearCompleted}
                className="h-8 px-3 bg-bg-input border border-border rounded-md text-[13px] text-text-secondary hover:border-red-500 hover:text-red-400 transition select-none"
              >
                {t('dl.clearCompleted')}
              </button>
            </div>
          </div>
          {completed.map((c) => (
            <div
              key={c.item_id}
              className="bg-bg-card/20 border border-border rounded-xl px-4 py-3.5 mb-2 flex items-center gap-3"
            >
              <span className="text-lg flex-shrink-0">✅</span>
              <div className="flex-1 min-w-0">
                <div className="text-lg text-text-primary truncate">{c.name}</div>
                <div className="text-base text-text-muted truncate mt-0.5">{c.album}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
