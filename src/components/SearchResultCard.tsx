import { useState } from 'react'
import QualityBadge from './QualityBadge'

export interface ResultProps {
  cover?: string
  title: string
  type: 'album' | 'track' | 'playlist'
  artist: string
  meta: string[]
  qualityTags: string[]
  selected?: boolean
  added?: boolean
  expanded?: boolean
  tracks?: { id: string; title: string; artist: string; added: boolean }[]
  onDownload: () => void
  onView?: () => void
  onTrackDownload?: (trackId: string) => void
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
  return (
    <div
      className={`border rounded-xl transition-colors animate-fade-in ${
        p.selected
          ? 'border-purple bg-purple-ghost/30'
          : 'border-border hover:border-purple/30'
      }`}
    >
      {/* Main row — same layout for all types */}
      <div className="flex gap-3 p-3.5 items-center">
        {/* Cover */}
        <div className="w-[72px] h-[72px] rounded-md bg-gradient-to-br from-bg-input to-bg-card flex-shrink-0 flex items-center justify-center overflow-hidden text-2xl">
          {p.cover ? (
            <img src={p.cover} alt="" className="w-full h-full object-cover" />
          ) : (
            coverIcons[p.type]
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-base font-semibold text-text-primary truncate">
              {p.title}
            </span>
            <span
              className={`text-[13px] px-1.5 py-0.5 rounded font-medium uppercase ${typeBadge[p.type]}`}
            >
              {p.type}
            </span>
          </div>

          <div className="text-[13px] text-text-secondary mb-1">{p.artist}</div>

          {p.meta.length > 0 && (
            <div className="flex gap-3.5 flex-wrap mb-2">
              {p.meta.map((m, i) => (
                <span key={i} className="text-[12px] text-text-muted">
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
            {/* All types get a Download button — stays purple */}
            <button
              onClick={p.onDownload}
              className="h-[34px] px-4 bg-purple text-white rounded-md text-[13px] font-medium hover:bg-[#6d28d9] transition"
            >
              Download
            </button>
            {(p.type === 'album' || p.type === 'playlist') && p.onView && (
              <button
                onClick={p.onView}
                className="h-[34px] px-4 bg-bg-input text-text-secondary border border-border rounded-md text-[13px] hover:border-text-muted transition"
              >
                {p.expanded ? 'Hide ▴' : 'View ▾'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded track list */}
      {p.expanded && p.tracks && (
        <div className="border-t border-border px-3.5 py-2 animate-fade-in">
          {p.tracks.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2.5 py-2 border-b border-white/[0.02] last:border-b-0"
            >
              <span className="text-sm flex-shrink-0">🎵</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-primary truncate">{t.title}</div>
                <div className="text-[12px] text-text-muted truncate">{t.artist}</div>
              </div>
              <button
                onClick={() => p.onTrackDownload?.(t.id)}
                className="h-[24px] px-3 bg-purple text-white rounded text-[12px] hover:bg-[#6d28d9] transition flex-shrink-0"
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
