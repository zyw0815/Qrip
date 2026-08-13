import { useState, useEffect } from 'react'
import ProgressBar from '../components/ProgressBar'
import { API_BASE } from '../App'

interface DownloadItem {
  item_id: string
  name: string
  album: string
  downloaded: number
  total: number
  speed: string
  status: 'downloading' | 'queued' | 'paused' | 'completed' | 'failed'
  paused?: boolean
}

export default function DownloadsTab() {
  const [downloading, setDownloading] = useState<DownloadItem[]>([])
  const [queued, setQueued] = useState<DownloadItem[]>([])

  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/download/status`)
        const data = await r.json()
        setDownloading(data.downloading || [])
        setQueued(data.queue || [])
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

  if (downloading.length === 0 && queued.length === 0) {
    return (
      <div className="p-5 animate-fade-in h-full">
        <div className="text-center py-24">
          <p className="text-5xl mb-5 opacity-40">⬇</p>
          <p className="text-text-muted text-sm font-medium">No downloads yet</p>
          <p className="text-text-muted/50 text-xs mt-2">
            Search for music or paste a URL to get started
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
          <p className="text-xs text-text-muted tracking-wider mb-2.5 font-semibold uppercase">
            Downloading — {downloading.length} active
          </p>
          {downloading.map((d) => (
            <div
              key={d.item_id}
              className="bg-bg-card/40 border border-border rounded-xl p-4 mb-2.5 hover:border-purple/25 transition"
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-text-primary font-medium truncate mr-2">
                  {d.name}
                </span>
                <span className="text-sm text-purple-light flex-shrink-0 font-medium">
                  {d.downloaded} MB / {d.total} MB
                </span>
              </div>
              <ProgressBar
                percent={d.total > 0 ? (d.downloaded / d.total) * 100 : 0}
              />
              <div className="flex justify-between mt-2.5 items-center">
                <span className="text-xs text-text-muted">
                  {d.paused ? '⏸ Paused' : `${d.speed} MB/s`}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => (d.paused ? resume(d.item_id) : pause(d.item_id))}
                    className="h-8 px-3.5 bg-bg-input border border-border rounded-md text-xs text-text-secondary hover:border-purple hover:text-purple-light transition select-none"
                  >
                    {d.paused ? '▶ Resume' : '⏸ Pause'}
                  </button>
                  <button
                    onClick={() => cancel(d.item_id)}
                    className="h-8 px-3.5 bg-bg-input border border-border rounded-md text-xs text-text-secondary hover:border-red-500 hover:text-red-400 transition select-none"
                  >
                    ✕ Delete
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
          <p className="text-xs text-text-muted tracking-wider mb-2.5 mt-5 font-semibold uppercase">
            Queued
          </p>
          {queued.map((q, i) => (
            <div
              key={q.item_id}
              className="bg-bg-card/20 border border-border rounded-xl px-4 py-3.5 mb-2 flex items-center gap-3"
            >
              <span className="text-base flex-shrink-0">⏳</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{q.name}</div>
                <div className="text-xs text-text-muted truncate mt-0.5">{q.album}</div>
              </div>
              <span className="text-xs text-text-muted flex-shrink-0">
                #{downloading.length + i + 1}
              </span>
              <button
                onClick={() => cancel(q.item_id)}
                className="h-8 px-3 bg-bg-input border border-border rounded-md text-xs text-text-secondary hover:border-red-500 hover:text-red-400 transition flex-shrink-0"
              >
                ✕ Delete
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
