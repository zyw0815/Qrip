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
          <p className="text-[9px] text-text-muted tracking-wider mb-2 font-medium uppercase">
            Downloading — {downloading.length} active
          </p>
          {downloading.map((d) => (
            <div
              key={d.item_id}
              className="bg-bg-card/40 border border-border rounded-lg p-3.5 mb-2 hover:border-purple/25 transition"
            >
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs text-text-primary font-medium truncate mr-2">
                  {d.name}
                </span>
                <span className="text-[10px] text-purple-light flex-shrink-0">
                  {d.downloaded} MB / {d.total} MB
                </span>
              </div>
              <ProgressBar
                percent={d.total > 0 ? (d.downloaded / d.total) * 100 : 0}
              />
              <div className="flex justify-between mt-1.5">
                <span className="text-[10px] text-text-muted">{d.speed} MB/s</span>
                <span
                  className="text-[10px] text-text-muted cursor-pointer hover:text-text-secondary select-none"
                  onClick={() => pause(d.item_id)}
                >
                  ⏸ Pause
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Queued */}
      {queued.length > 0 && (
        <>
          <p className="text-[9px] text-text-muted tracking-wider mb-2 mt-4 font-medium uppercase">
            Queued
          </p>
          {queued.map((q, i) => (
            <div
              key={q.item_id}
              className="bg-bg-card/20 border border-border rounded-lg px-3.5 py-3 mb-1.5 flex items-center gap-2.5"
            >
              <span className="text-sm flex-shrink-0">⏳</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-text-primary truncate">{q.name}</div>
                <div className="text-[10px] text-text-muted truncate">{q.album}</div>
              </div>
              <span className="text-[10px] text-text-muted flex-shrink-0">
                #{downloading.length + i + 1}
              </span>
              <span
                className="text-[10px] text-text-muted cursor-pointer hover:text-red-400 flex-shrink-0"
                onClick={() => cancel(q.item_id)}
              >
                ✕
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
