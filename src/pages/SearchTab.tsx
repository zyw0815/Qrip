import { useState } from 'react'
import SearchResultCard from '../components/SearchResultCard'
import { API_BASE } from '../App'
import { useI18n } from '../i18n'

type Mode = 'url' | 'search'
type FilterType = 'all' | 'album' | 'track' | 'playlist'

interface Result {
  id: string
  type: 'album' | 'track' | 'playlist'
  title: string
  artist: string
  meta: string[]
  qualityTags: string[]
  cover?: string
}

export default function SearchTab() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('url')
  // Separate state per mode — switching modes preserves both sides
  const [urlInput, setUrlInput] = useState('')
  const [urlResults, setUrlResults] = useState<Result[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<Result[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const input = mode === 'url' ? urlInput : searchInput
  const results = mode === 'url' ? urlResults : searchResults
  const setInput = mode === 'url' ? setUrlInput : setSearchInput
  const setResults = mode === 'url' ? setUrlResults : setSearchResults
  const hasMore = mode === 'search' && results.length < total

  const handleResolve = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/search/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input.trim() }),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.detail || t('search.errResolve'))
        return
      }
      const data = await r.json()
      setResults([formatResult(data, t)])
    } catch {
      setError(t('search.errConn'))
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError('')
    try {
      const mediaType = filter === 'all' ? 'album' : filter
      const r = await fetch(`${API_BASE}/search/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input.trim(), media_type: mediaType }),
      })
      if (!r.ok) {
        const d = await r.json()
        setError(d.detail || t('search.errSearch'))
        return
      }
      const data = await r.json()
      setResults((data.results || []).map((x: Record<string, unknown>) => formatResult(x, t)))
      setTotal(data.total || 0)
    } catch {
      setError(t('search.errConn'))
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (!input.trim() || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const mediaType = filter === 'all' ? 'album' : filter
      const r = await fetch(`${API_BASE}/search/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input.trim(),
          media_type: mediaType,
          offset: results.length,
        }),
      })
      if (r.ok) {
        const data = await r.json()
        setResults((prev) => [...prev, ...(data.results || []).map((x: Record<string, unknown>) => formatResult(x, t))])
        setTotal(data.total || 0)
      }
    } catch {
      setError(t('search.errConn'))
    } finally {
      setLoadingMore(false)
    }
  }

  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [trackLists, setTrackLists] = useState<Map<string, { id: string; title: string; artist: string; added: boolean }[]>>(new Map())

  const addToQueue = async (result: Result) => {
    try {
      const r = await fetch(`${API_BASE}/download/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: result.id, media_type: result.type }),
      })
      if (r.ok) {
        setAddedIds((prev) => new Set(prev).add(result.id))
      }
    } catch {
      setError(t('search.errAdd'))
    }
  }

  const toggleView = async (result: Result) => {
    if (expandedIds.has(result.id)) {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.delete(result.id)
        return next
      })
      return
    }
    // Fetch track list
    try {
      const r = await fetch(`${API_BASE}/search/tracks/${result.id}`)
      if (r.ok) {
        const data = await r.json()
        const tracks = (data.tracks || []).map((x: { id: string; title: string; artist: string }) => ({
          ...x,
          added: addedIds.has(x.id),
        }))
        setTrackLists((prev) => new Map(prev).set(result.id, tracks))
        setExpandedIds((prev) => new Set(prev).add(result.id))
      }
    } catch {
      setError(t('search.errTracks'))
    }
  }

  return (
    <div className="p-5 animate-fade-in h-full">
      {/* Mode Switcher */}
      <div className="flex gap-2 mb-5">
        {(['url', 'search'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m)
              setError('')
            }}
            className={`flex-1 py-2.5 rounded-lg text-base font-medium transition border ${
              mode === m
                ? 'bg-purple text-white border-purple'
                : 'bg-bg-input text-text-muted border-border hover:border-text-muted'
            }`}
          >
            {m === 'url' ? t('search.urlTab') : t('search.searchTab')}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="mb-4">
        <label className="text-[13px] text-text-muted block mb-1">
          {mode === 'url' ? t('search.pasteLabel') : t('search.searchLabel')}
        </label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === 'Enter' && (mode === 'url' ? handleResolve() : handleSearch())
          }
          placeholder={
            mode === 'url'
              ? 'open.qobuz.com/album/...'
              : t('search.searchPlaceholder')
          }
          className="w-full h-[46px] bg-bg-input border border-purple rounded-lg px-3 text-lg text-purple-light placeholder:text-text-muted outline-none transition"
        />
      </div>

      {/* URL Mode: hint box */}
      {mode === 'url' && (
        <div className="bg-bg-card/40 border border-border rounded-lg p-4 mb-4">
          <p className="text-[13px] text-text-muted tracking-wider mb-2 uppercase">
            {t('search.supported')}
          </p>
          <p className="text-[13px] text-text-secondary py-0.5">
            {t('search.trackLink')}{' '}
            <b className="text-purple-light">open.qobuz.com/track</b>/...
          </p>
          <p className="text-[13px] text-text-secondary py-0.5">
            {t('search.albumLink')}{' '}
            <b className="text-purple-light">open.qobuz.com/album</b>/...
          </p>
          <p className="text-[13px] text-text-secondary py-0.5">
            {t('search.playlistLink')}{' '}
            <b className="text-purple-light">open.qobuz.com/playlist</b>/...
          </p>
        </div>
      )}

      {/* Search Mode: filters */}
      {mode === 'search' && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {(['all', 'album', 'track', 'playlist'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[13px] px-3 py-1 rounded-full transition border ${
                filter === f
                  ? 'bg-purple-ghost text-purple-light border-purple'
                  : 'bg-bg-input text-text-muted border-transparent hover:border-border'
              }`}
            >
              {f === 'all'
                ? t('search.filterAll')
                : f === 'album'
                  ? t('search.filterAlbums')
                  : f === 'track'
                    ? t('search.filterTracks')
                    : t('search.filterPlaylists')}
            </button>
          ))}
        </div>
      )}

      {/* Action button */}
      <div className="text-center mb-6">
        <button
          onClick={mode === 'url' ? handleResolve : handleSearch}
          disabled={loading || !input.trim()}
          className="h-10 px-10 bg-purple text-white rounded-md text-base font-medium hover:bg-[#6d28d9] transition disabled:opacity-50"
        >
          {loading ? t('search.working') : mode === 'url' ? t('search.resolve') : t('search.searchBtn')}
        </button>
      </div>

      {error && (
        <p className="text-red-500 text-base text-center mb-4 animate-fade-in">
          {error}
        </p>
      )}

      {/* Results */}
      <div className="flex flex-col gap-2">
        {results.map((r, i) => (
          <SearchResultCard
            key={`${r.id}-${i}`}
            {...r}
            selected={i === 0}
            added={addedIds.has(r.id)}
            expanded={expandedIds.has(r.id)}
            tracks={trackLists.get(r.id)}
            onDownload={() => addToQueue(r)}
            onView={() => toggleView(r)}
            onTrackDownload={(trackId) =>
              addToQueue({ id: trackId, type: 'track', title: '', artist: '', meta: [], qualityTags: [] })
            }
          />
        ))}
      </div>

      {/* Load more */}
      {mode === 'search' && hasMore && (
        <div className="text-center mt-4">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="h-10 px-8 bg-bg-input border border-border text-text-secondary rounded-lg text-base font-medium hover:border-purple hover:text-purple-light transition disabled:opacity-50"
          >
            {loadingMore
              ? t('search.loadingMore')
              : t('search.loadMore', { n: total - results.length })}
          </button>
        </div>
      )}
    </div>
  )
}

function formatResult(
  item: Record<string, any>,
  t: (key: string, vars?: Record<string, string | number>) => string,
): Result {
  // Resolve returns {type, data}; search returns the item directly
  const d = item.data || item
  const meta: string[] = []
  if (d.album_title) meta.push(`💿 ${d.album_title}`)
  if (d.year) meta.push(String(d.year))
  if (d.tracks_count) meta.push(t('search.metaTracks', { n: d.tracks_count }))
  if (d.duration) {
    const mins = Math.floor(Number(d.duration) / 60)
    const secs = Number(d.duration) % 60
    meta.push(`${mins}:${String(secs).padStart(2, '0')}`)
  }
  if (d.label) meta.push(String(d.label))

  const qualityTags: string[] = []
  if (d.bit_depth) qualityTags.push(`FLAC ${d.bit_depth}-bit`)
  if (d.sampling_rate) {
    const sr = Number(d.sampling_rate)
    qualityTags.push(sr >= 1000 ? `${sr / 1000} kHz` : `${sr} Hz`)
  }

  return {
    id: d.id || '',
    type: d.type || item.type || 'album',
    title: d.title || d.name || 'Unknown',
    artist: d.artist || '',
    meta,
    qualityTags,
    cover: d.cover || undefined,
  }
}
