import { useState, useEffect } from 'react'
import { ShieldCheck } from 'lucide-react'
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
  failure_id?: string
  phase?: 'verifying' | 'retrying' | 'cd_retry'
  cd_fallbacks?: { path: string; title: string }[]
}

export interface DownloadActivity {
  active: number
  queued: number
  busyIds: ReadonlySet<string>
}

function CdFallbacks({ tracks }: { tracks: NonNullable<DownloadItem['cd_fallbacks']> }) {
  const { t } = useI18n()
  return (
    <ul className="mt-1.5 space-y-0.5 text-sm text-purple-light">
      {tracks.map((track, index) => (
        <li key={`${track.path}-${index}`} className="break-words">
          {t('dl.cdFallback', { track: track.title })}
        </li>
      ))}
    </ul>
  )
}

export default function DownloadsTab({ refreshKey, onActivityChange, onRefresh }: {
  refreshKey: number
  onActivityChange: (activity: DownloadActivity) => void
  onRefresh: () => void
}) {
  const { t } = useI18n()
  const [downloading, setDownloading] = useState<DownloadItem[]>([])
  const [queued, setQueued] = useState<DownloadItem[]>([])
  const [failed, setFailed] = useState<DownloadItem[]>([])
  const [completed, setCompleted] = useState<DownloadItem[]>([])
  const [deleteFilesOnClear, setDeleteFilesOnClear] = useState(false)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/download/status`, { signal: controller.signal })
        if (!r.ok) return
        const data = await r.json()
        if (controller.signal.aborted) return
        const current: DownloadItem[] = (data.downloading || []).filter(
          (item: DownloadItem) => item.status === 'downloading' || item.status === 'paused',
        )
        const waiting: DownloadItem[] = data.queue || []
        setDownloading(current)
        setQueued(waiting)
        setFailed(data.failed || [])
        setCompleted(data.completed || [])
        onActivityChange({
          active: current.filter((item) => !item.paused && item.status !== 'paused').length,
          queued: waiting.length,
          busyIds: new Set([...current, ...waiting].map((item) => item.item_id)),
        })
      } catch {
        // backend might not be ready yet
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refreshKey, onActivityChange])

  const pause = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/pause`, { method: 'POST' })
  }
  const resume = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/resume`, { method: 'POST' })
  }
  const cancel = async (id: string) => {
    await fetch(`${API_BASE}/download/${id}/cancel`, { method: 'POST' })
  }
  const actOnFailure = async (id: string, action: 'retry' | 'delete') => {
    setActing(true)
    setActionError(null)
    try {
      const url = action === 'retry' ? `${id}/retry` : `failed/${id}`
      const response = await fetch(`${API_BASE}/download/${url}`, {
        method: action === 'retry' ? 'POST' : 'DELETE',
      })
      if (!response.ok && response.status !== 404) throw new Error()
      if (action === 'retry' && (await response.json()).status === 'already_queued') {
        setActionError({ id, message: t('dl.alreadyQueued') })
      }
      onRefresh()
    } catch {
      setActionError({ id, message: t(action === 'delete' ? 'dl.deleteFailedError' : 'dl.retryError') })
    } finally {
      setActing(false)
    }
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
              {d.phase === 'verifying' ? (
                <div
                  role="progressbar"
                  aria-label={t('dl.verifying')}
                  className="h-1 rounded-full bg-purple-ghost overflow-hidden"
                >
                  <div className="h-full rounded-full bg-gradient-to-r from-purple via-purple-light to-purple motion-safe:animate-pulse" />
                </div>
              ) : (
                <ProgressBar percent={d.total > 0 ? (d.downloaded / d.total) * 100 : 0} />
              )}
              <div className="flex justify-between mt-2.5 items-center">
                <span className={`inline-flex items-center gap-2 text-base ${d.phase ? 'text-purple-light' : 'text-text-muted'}`}>
                  {d.phase === 'verifying' && <ShieldCheck aria-hidden="true" className="h-4 w-4 motion-safe:animate-pulse" />}
                  {d.phase === 'verifying' ? t('dl.verifying') : d.paused ? t('dl.pausedLabel')
                    : d.phase === 'cd_retry' ? t('dl.retryingCd')
                    : d.phase === 'retrying' ? t('dl.retrying') : `${d.speed} MB/s`}
                </span>
                <div className="flex gap-2">
                  {d.phase !== 'verifying' && (
                    <button
                      onClick={() => (d.paused ? resume(d.item_id) : pause(d.item_id))}
                      className="h-9 px-3.5 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-purple hover:text-purple-light transition select-none"
                    >
                      {d.paused ? t('dl.resume') : t('dl.pause')}
                    </button>
                  )}
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
              key={f.failure_id || f.item_id}
              className="bg-bg-card/20 border border-red-500/30 rounded-xl px-4 py-3.5 mb-2 flex items-center gap-3"
            >
              <span className="text-lg flex-shrink-0">⚠️</span>
              <div className="flex-1 min-w-0">
                <div className="text-lg text-text-primary truncate">{f.name}</div>
                <div className="text-base text-red-400/90 truncate mt-0.5">
                  {f.error || t('dl.failed')}
                </div>
                {f.error && (
                  <details className="mt-1 text-sm text-red-400/90">
                    <summary className="cursor-pointer select-none">{t('dl.errorDetails')}</summary>
                    <div className="mt-2 whitespace-pre-wrap break-words">{f.error}</div>
                  </details>
                )}
                {!!f.cd_fallbacks?.length && <CdFallbacks tracks={f.cd_fallbacks} />}
                {actionError?.id === (f.failure_id || f.item_id) && (
                  <p role="alert" className="mt-2 text-sm text-red-400">{actionError.message}</p>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => actOnFailure(f.failure_id || f.item_id, 'retry')}
                  disabled={acting}
                  className="h-9 px-3.5 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-purple hover:text-purple-light transition disabled:opacity-50"
                >
                  {t('dl.retry')}
                </button>
                {f.failure_id && (
                  <button
                    onClick={() => actOnFailure(f.failure_id!, 'delete')}
                    disabled={acting}
                    title={t('dl.deleteFailedHint')}
                    className="h-9 px-3 bg-bg-input border border-border rounded-md text-base text-text-secondary hover:border-red-500 hover:text-red-400 transition disabled:opacity-50"
                  >
                    {t('dl.delete')}
                  </button>
                )}
              </div>
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
                {!!c.cd_fallbacks?.length && <CdFallbacks tracks={c.cd_fallbacks} />}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
