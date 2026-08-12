import QualityBadge from './QualityBadge'

export interface ResultProps {
  cover?: string
  title: string
  type: 'album' | 'track' | 'playlist'
  artist: string
  meta: string[]
  qualityTags: string[]
  selected?: boolean
  onDownload: () => void
  onView?: () => void
  onAdd?: () => void
}

const typeBadge: Record<string, string> = {
  album: 'bg-purple-ghost text-purple-light',
  track: 'bg-bg-input text-text-muted',
  playlist: 'bg-purple-ghost/60 text-[#c4b5fd]',
}

const coverIcons: Record<string, string> = {
  album: '💿',
  track: '🎵',
  playlist: '📋',
}

export default function SearchResultCard(p: ResultProps) {
  const isSmall = p.type === 'track'

  return (
    <div
      className={`flex gap-3 p-3.5 rounded-xl border transition-colors animate-fade-in ${
        p.selected
          ? 'border-purple bg-purple-ghost/30'
          : 'border-border hover:border-purple/30'
      } ${isSmall ? 'items-center' : ''}`}
    >
      {/* Cover */}
      <div
        className={`${
          isSmall ? 'w-10 h-10 text-base' : 'w-[72px] h-[72px] text-2xl'
        } rounded-md bg-gradient-to-br from-bg-input to-bg-card flex-shrink-0 flex items-center justify-center overflow-hidden`}
      >
        {p.cover ? (
          <img src={p.cover} alt="" className="w-full h-full object-cover" />
        ) : (
          coverIcons[p.type]
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className={`${isSmall ? 'text-xs' : 'text-sm'} font-semibold text-text-primary truncate`}
          >
            {p.title}
          </span>
          <span
            className={`text-[8px] px-1.5 py-0.5 rounded font-medium uppercase ${typeBadge[p.type]}`}
          >
            {p.type}
          </span>
        </div>

        <div className="text-[11px] text-text-secondary mb-1">{p.artist}</div>

        {p.meta.length > 0 && (
          <div className="flex gap-3.5 flex-wrap mb-2">
            {p.meta.map((m, i) => (
              <span key={i} className="text-[10px] text-text-muted">
                {m}
              </span>
            ))}
          </div>
        )}

        {p.qualityTags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2.5">
            {p.qualityTags.map((q, i) => (
              <QualityBadge key={i} label={q} />
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {(p.type === 'album' || p.type === 'playlist') && (
            <>
              <button
                onClick={p.onDownload}
                className="h-[30px] px-4 bg-purple text-white rounded-md text-[11px] font-medium hover:bg-[#6d28d9] transition"
              >
                Download
              </button>
              {p.onView && (
                <button
                  onClick={p.onView}
                  className="h-[30px] px-4 bg-bg-input text-text-secondary border border-border rounded-md text-[11px] hover:border-text-muted transition"
                >
                  View ▾
                </button>
              )}
            </>
          )}
          {p.type === 'track' && p.onAdd && (
            <button
              onClick={p.onAdd}
              className="h-[26px] px-4 bg-bg-input text-text-secondary border border-border rounded-md text-[10px] hover:border-text-muted hover:text-text-primary transition"
            >
              + Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
