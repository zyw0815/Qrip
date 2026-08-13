import { useState } from 'react'
import SearchResultCard from '../components/SearchResultCard'
import { API_BASE } from '../App'

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
  const [mode, setMode] = useState<Mode>('url')
  // Separate state per mode — switching modes preserves both sides
  const [urlInput, setUrlInput] = useState('')
  const [urlResults, setUrlResults] = useState<Result[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState<Result[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const input = mode === 'url' ? urlInput : searchInput
  const results = mode === 'url' ? urlResults : searchResults
  const setInput = mode === 'url' ? setUrlInput : setSearchInput
  const setResults = mode === 'url' ? setUrlResults : setSearchResults

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
        setError(d.detail || 'Failed to resolve URL')
        return
      }
      const data = await r.json()
      setResults([formatResult(data)])
    } catch {
      setError('Backend connection failed')
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
        setError(d.detail || 'Search failed')
        return
      }
      const data = await r.json()
      setResults((data.results || []).map(formatResult))
    } catch {
      setError('Backend connection failed')
    } finally {
      setLoading(false)
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
      setError('Failed to add to download queue')
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
        const tracks = (data.tracks || []).map((t: { id: string; title: string; artist: string }) => ({
          ...t,
          added: addedIds.has(t.id),
        }))
        setTrackLists((prev) => new Map(prev).set(result.id, tracks))
        setExpandedIds((prev) => new Set(prev).add(result.id))
      }
    } catch {
      setError('Failed to load tracks')
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
            className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition border ${
              mode === m
                ? 'bg-purple text-white border-purple'
                : 'bg-bg-input text-text-muted border-border hover:border-text-muted'
            }`}
          >
            {m === 'url' ? '🔗 URL' : '🔍 Search'}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="mb-4">
        <label className="text-[10px] text-text-muted block mb-1">
          {mode === 'url' ? 'Paste a Qobuz link' : 'Search Qobuz'}
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
              : 'Artist, album, or track name...'
          }
          className="w-full h-[42px] bg-bg-input border border-purple rounded-lg px-3 text-sm text-purple-light placeholder:text-text-muted outline-none transition"
        />
      </div>

      {/* URL Mode: hint box */}
      {mode === 'url' && (
        <div className="bg-bg-card/40 border border-border rounded-lg p-4 mb-4">
          <p className="text-[9px] text-text-muted tracking-wider mb-2 uppercase">
            Supported Links
          </p>
          <p className="text-[10px] text-text-secondary py-0.5">
            🎵 Track:{' '}
            <b className="text-purple-light">open.qobuz.com/track</b>/...
          </p>
          <p className="text-[10px] text-text-secondary py-0.5">
            💿 Album:{' '}
            <b className="text-purple-light">open.qobuz.com/album</b>/...
          </p>
          <p className="text-[10px] text-text-secondary py-0.5">
            📋 Playlist:{' '}
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
              className={`text-[10px] px-3 py-1 rounded-full transition border ${
                filter === f
                  ? 'bg-purple-ghost text-purple-light border-purple'
                  : 'bg-bg-input text-text-muted border-transparent hover:border-border'
              }`}
            >
              {f === 'all'
                ? 'All'
                : f === 'album'
                  ? '💿 Albums'
                  : f === 'track'
                    ? '🎵 Tracks'
                    : '📋 Playlists'}
            </button>
          ))}
        </div>
      )}

      {/* Action button */}
      <div className="text-center mb-6">
        <button
          onClick={mode === 'url' ? handleResolve : handleSearch}
          disabled={loading || !input.trim()}
          className="h-9 px-10 bg-purple text-white rounded-md text-xs font-medium hover:bg-[#6d28d9] transition disabled:opacity-50"
        >
          {loading ? 'Working...' : mode === 'url' ? 'Resolve ▸' : 'Search ▸'}
        </button>
      </div>

      {error && (
        <p className="text-red-500 text-xs text-center mb-4 animate-fade-in">
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
    </div>
  )
}

function formatResult(item: Record<string, any>): Result {
  // Resolve returns {type, data}; search returns the item directly
  const d = item.data || item
  const meta: string[] = []
  if (d.album_title) meta.push(`💿 ${d.album_title}`)
  if (d.year) meta.push(String(d.year))
  if (d.tracks_count) meta.push(`${d.tracks_count} tracks`)
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
