import { useState, useEffect, useRef } from 'react'
import Toggle from '../components/Toggle'
import { API_BASE } from '../App'

const FOLDER_PRESETS = [
  "{artist} — {album} ({year})",
  "{artist} / {album}",
  "{artist} / ({year}) {album}",
  "{artist} — {album}",
]
const FILE_PRESETS = [
  "{artist} — {title}",
  "{track}. {title}",
  "{track} — {title}",
  "{track} {artist} — {title}",
]
const QUALITY_TIERS = [
  { label: "MP3 320 kbps", value: 0 },
  { label: "FLAC 16-bit / 44.1 kHz", value: 1 },
  { label: "FLAC 24-bit / 96 kHz", value: 2 },
  { label: "FLAC 24-bit / 192 kHz", value: 3 },
]
const EMBED_SIZES = ["Thumbnail (≈250×250)", "Small (≈600×600)", "Large (≈1400×1400)", "Original"]
const SAVED_WIDTHS = ["250", "600", "1400", "Original (no resize)"]

function Dropdown({ value, options, onSelect, open, onToggle }: {
  value: string
  options: string[]
  onSelect: (v: string) => void
  open: boolean
  onToggle: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onToggle() }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onToggle])

  return (
    <div className="relative" ref={ref}>
      <div onClick={onToggle}
        className="px-3 py-2 bg-bg-input border border-border rounded-lg flex justify-between items-center cursor-pointer hover:border-text-muted transition-colors"
      >
        <span className="text-sm text-text-primary">{value}</span>
        <span className="text-xs text-purple-light">▾</span>
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-bg-input border border-border rounded-lg shadow-lg overflow-hidden">
          {options.map((o) => (
            <div key={o} onClick={() => { onSelect(o); onToggle() }}
              className={`px-3 py-2 text-xs cursor-pointer hover:bg-purple-ghost transition-colors ${o === value ? 'text-purple-light' : 'text-text-secondary'}`}
            >{o}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplatePreview({ template, type }: { template: string; type: 'folder' | 'file' }) {
  const artist = "Daft Punk"
  const album = "Random Access Memories"
  const year = "2013"
  const track = "01"
  const trackArtist = artist
  const title = "Get Lucky"
  const bit = "24"
  const result = template
    .replace("{artist}", type === 'folder' ? artist : trackArtist)
    .replace("{album}", album)
    .replace("{year}", year)
    .replace("{track}", track)
    .replace("{title}", title)
    .replace("{bit_depth}", `${bit}bit`)
  return <span className="text-text-secondary">{result}{type === 'file' ? '.flac' : ''}</span>
}

export default function SettingsTab() {
  const [folder, setFolder] = useState('~/Music/Qrip')
  const [qualityIdx, setQualityIdx] = useState(3)
  const [folderFmt, setFolderFmt] = useState(FOLDER_PRESETS[0])
  const [fileFmt, setFileFmt] = useState(FILE_PRESETS[0])
  const [embedCover, setEmbedCover] = useState(true)
  const [embedSize, setEmbedSize] = useState(EMBED_SIZES[2])
  const [saveCover, setSaveCover] = useState(false)
  const [savedWidth, setSavedWidth] = useState(SAVED_WIDTHS[3])

  // Dropdown open states
  const [qualityOpen, setQualityOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [fileOpen, setFileOpen] = useState(false)
  const [embedSizeOpen, setEmbedSizeOpen] = useState(false)
  const [savedWidthOpen, setSavedWidthOpen] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/config/`)
      .then((r) => r.json())
      .then((d) => {
        if (d.download_folder) setFolder(d.download_folder)
        if (typeof d.quality === 'number') setQualityIdx(d.quality)
        if (d.folder_format) setFolderFmt(d.folder_format)
        if (d.track_format) setFileFmt(d.track_format)
        if (typeof d.embed_cover === 'boolean') setEmbedCover(d.embed_cover)
        if (d.embed_size) setEmbedSize(d.embed_size)
        if (typeof d.save_artwork === 'boolean') setSaveCover(d.save_artwork)
      })
      .catch(() => {})
  }, [])

  const update = (key: string, value: string | number | boolean) => {
    fetch(`${API_BASE}/config/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }).catch(() => {})
  }

  const signOut = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST' })
    window.location.reload()
  }

  const sectionTitle = 'text-[10px] font-semibold text-purple-light tracking-wider mb-3.5 uppercase'
  const sublabel = 'text-[11px] text-text-muted block mb-1'

  const currentQuality = QUALITY_TIERS[qualityIdx]?.label || QUALITY_TIERS[3].label

  return (
    <div className="p-5 animate-fade-in">
      {/* DOWNLOAD */}
      <section className="mb-7">
        <h2 className={sectionTitle}>Download</h2>

        <div className="mb-3">
          <label className={sublabel}>Base download folder</label>
          <div className="flex gap-2">
            <input value={folder} onChange={(e) => { setFolder(e.target.value); update('download_folder', e.target.value) }}
              className="flex-1 h-9 bg-bg-input border border-border rounded-lg px-2.5 text-[11px] text-text-secondary font-mono outline-none focus:border-purple"
            />
            <button
              onClick={async () => {
                if (window.electronAPI?.pickFolder) {
                  const path = await window.electronAPI.pickFolder()
                  if (path) { setFolder(path); update('download_folder', path) }
                }
              }}
              className="w-9 h-9 bg-bg-input border border-border rounded-lg flex items-center justify-center text-sm hover:border-text-muted transition flex-shrink-0">📂</button>
          </div>
        </div>

        <div className="mb-3">
          <label className={sublabel}>Audio quality</label>
          <Dropdown value={currentQuality} options={QUALITY_TIERS.map((t) => t.label)}
            open={qualityOpen} onToggle={() => setQualityOpen(!qualityOpen)}
            onSelect={(v) => {
              const idx = QUALITY_TIERS.findIndex((t) => t.label === v)
              setQualityIdx(idx)
              update('quality', idx)
            }}
          />
        </div>

        <div className="mb-3.5 bg-bg-card/30 border border-border rounded-xl p-3.5">
          <label className={sublabel}>Folder structure</label>
          <Dropdown value={folderFmt} options={FOLDER_PRESETS}
            open={folderOpen} onToggle={() => setFolderOpen(!folderOpen)}
            onSelect={(v) => { setFolderFmt(v); update('folder_format', v) }}
          />
          <p className="text-[9px] text-text-muted mt-1.5">
            Preview: <TemplatePreview template={folderFmt} type="folder" />
          </p>
        </div>

        <div className="bg-bg-card/30 border border-border rounded-xl p-3.5">
          <div className="flex justify-between items-center mb-1">
            <label className={sublabel}>File name template</label>
            <span className="text-[9px] text-purple-light cursor-pointer select-none">+ Custom ▸</span>
          </div>
          <Dropdown value={fileFmt} options={FILE_PRESETS}
            open={fileOpen} onToggle={() => setFileOpen(!fileOpen)}
            onSelect={(v) => { setFileFmt(v); update('track_format', v) }}
          />
          <p className="text-[9px] text-text-muted mt-1.5">
            Preview: <TemplatePreview template={fileFmt} type="file" />
          </p>
        </div>
      </section>

      {/* ARTWORK */}
      <section className="mb-7">
        <h2 className={sectionTitle}>Artwork</h2>

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-[11px] text-text-secondary">Embed cover in audio files</p>
            <p className="text-[9px] text-text-muted">Write cover art into FLAC metadata</p>
          </div>
          <Toggle enabled={embedCover} onChange={(v) => { setEmbedCover(v); update('embed_cover', v) }} />
        </div>

        <div className={embedCover ? 'mb-3' : 'mb-3 opacity-35 pointer-events-none'}>
          <label className={`${sublabel} mt-1`}>Embedded cover size</label>
          <Dropdown value={embedSize} options={EMBED_SIZES}
            open={embedSizeOpen} onToggle={() => setEmbedSizeOpen(!embedSizeOpen)}
            onSelect={(v) => { setEmbedSize(v); update('embed_size', v) }}
          />
        </div>

        <div className="border-t border-border mt-4 pt-3" />

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-[11px] text-text-muted">Save cover.jpg separately</p>
            <p className="text-[9px] text-text-muted">Save highest-quality cover next to audio files</p>
          </div>
          <Toggle enabled={saveCover} onChange={(v) => { setSaveCover(v); update('save_artwork', v) }} />
        </div>

        {saveCover && (
          <div className="mt-3 animate-fade-in">
            <label className={sublabel}>Saved cover max width</label>
            <Dropdown value={savedWidth} options={SAVED_WIDTHS}
              open={savedWidthOpen} onToggle={() => setSavedWidthOpen(!savedWidthOpen)}
              onSelect={(v) => { setSavedWidth(v); update('saved_max_width', v) }}
            />
          </div>
        )}
      </section>

      {/* ACCOUNT */}
      <section className="mb-7">
        <h2 className={sectionTitle}>Account</h2>
        <div className="bg-bg-card/40 border border-border rounded-xl p-3.5 flex items-center gap-2.5 mb-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-quality flex-shrink-0" />
          <div className="flex-1">
            <div className="text-[11px] text-text-primary">Qobuz — Connected</div>
            <div className="text-[10px] text-text-muted">Signed in · Ready to download</div>
          </div>
          <button onClick={signOut}
            className="h-7 px-3.5 border border-red-500 text-red-500 rounded text-[10px] hover:bg-red-500/10 transition flex-shrink-0"
          >Sign Out</button>
        </div>
        <div className="px-3 py-2 bg-bg-input border border-border rounded-lg flex justify-between items-center cursor-pointer hover:border-text-muted transition-colors">
          <span className="text-sm text-text-muted">🐙 Add another Qobuz account</span>
          <span className="text-xs text-purple-light">▾</span>
        </div>
      </section>

      {/* ABOUT */}
      <section>
        <h2 className={sectionTitle}>About</h2>
        <div className="flex justify-between items-center py-2 border-b border-white/[0.02]">
          <span className="text-[11px] text-text-muted">Version</span>
          <span className="text-[11px] text-text-secondary">0.1.0</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-white/[0.02]">
          <span className="text-[11px] text-text-muted">Check for updates</span>
          <span className="text-[10px] text-purple-light cursor-pointer select-none">Check ▸</span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-[11px] text-text-muted">Licenses</span>
          <span className="text-[10px] text-purple-light cursor-pointer select-none">View ▸</span>
        </div>
      </section>
    </div>
  )
}
