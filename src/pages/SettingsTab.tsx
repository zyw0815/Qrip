import { useState, useEffect } from 'react'
import Toggle from '../components/Toggle'
import SelectRow from '../components/SelectRow'
import { API_BASE } from '../App'

const FOLDER_PRESETS = [
  '{artist} — {album} ({year})',
  '{artist} / {album}',
  '{artist} / ({year}) {album}',
  '{artist} — {album}',
]
const FILE_PRESETS = [
  '{artist} — {title}',
  '{track}. {title}',
  '{track} — {title}',
  '{track} {artist} — {title}',
]

export default function SettingsTab() {
  const [folder, setFolder] = useState('~/Music/Qrip')
  const [folderFmt, setFolderFmt] = useState(FOLDER_PRESETS[0])
  const [fileFmt, setFileFmt] = useState(FILE_PRESETS[0])
  const [embedCover, setEmbedCover] = useState(true)
  const [embedSize, setEmbedSize] = useState('Large (≈1400×1400)')
  const [saveCover, setSaveCover] = useState(false)
  const [savedWidth, setSavedWidth] = useState('Original (no resize)')

  // Load config from backend on mount
  useEffect(() => {
    fetch(`${API_BASE}/config/`)
      .then((r) => r.json())
      .then((d) => {
        if (d.download_folder) setFolder(d.download_folder)
        if (d.folder_format) setFolderFmt(d.folder_format)
        if (d.track_format) setFileFmt(d.track_format)
        if (typeof d.embed_cover === 'boolean') setEmbedCover(d.embed_cover)
        if (typeof d.save_artwork === 'boolean') setSaveCover(d.save_artwork)
      })
      .catch(() => {})
  }, [])

  const update = async (key: string, value: string | number | boolean) => {
    await fetch(`${API_BASE}/config/update`, {
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

  return (
    <div className="p-5 animate-fade-in max-h-[calc(100vh-56px)] overflow-y-auto">
      {/* DOWNLOAD */}
      <section className="mb-7">
        <h2 className={sectionTitle}>Download</h2>

        <div className="mb-3">
          <label className={sublabel}>Base download folder</label>
          <div className="flex gap-2">
            <input
              value={folder}
              onChange={(e) => { setFolder(e.target.value); update('download_folder', e.target.value) }}
              className="flex-1 h-9 bg-bg-input border border-border rounded-lg px-2.5 text-[11px] text-text-secondary font-mono outline-none focus:border-purple"
            />
            <button
              className="w-9 h-9 bg-bg-input border border-border rounded-lg flex items-center justify-center text-sm hover:border-text-muted transition flex-shrink-0"
              aria-label="Choose folder"
            >
              📂
            </button>
          </div>
        </div>

        <div className="mb-3">
          <label className={sublabel}>Audio quality</label>
          <SelectRow value="FLAC 24-bit / 192 kHz" />
        </div>

        <div className="mb-3.5 bg-bg-card/30 border border-border rounded-xl p-3.5">
          <label className={sublabel}>Folder structure</label>
          <SelectRow value={folderFmt} />
          <p className="text-[9px] text-text-muted mt-1.5">
            Preview:{' '}
            <span className="text-text-secondary">
              Daft Punk — Random Access Memories (2013)
            </span>
          </p>
        </div>

        <div className="bg-bg-card/30 border border-border rounded-xl p-3.5">
          <div className="flex justify-between items-center mb-1">
            <label className={sublabel}>File name template</label>
            <span className="text-[9px] text-purple-light cursor-pointer select-none">
              + Custom ▸
            </span>
          </div>
          <SelectRow value={fileFmt} />
          <p className="text-[9px] text-text-muted mt-1.5">
            Preview:{' '}
            <span className="text-text-secondary">Daft Punk — Get Lucky.flac</span>
          </p>
        </div>
      </section>

      {/* ARTWORK */}
      <section className="mb-7">
        <h2 className={sectionTitle}>Artwork</h2>

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-[11px] text-text-secondary">Embed cover in audio files</p>
            <p className="text-[9px] text-text-muted">
              Write cover art into FLAC metadata
            </p>
          </div>
          <Toggle
            enabled={embedCover}
            onChange={(v) => {
              setEmbedCover(v)
              update('embed_cover', v)
            }}
          />
        </div>

        <div className={embedCover ? 'mb-3' : 'mb-3 opacity-35 pointer-events-none'}>
          <label className={`${sublabel} mt-1`}>Embedded cover size</label>
          <SelectRow value={embedSize} />
        </div>

        <div className="border-t border-border mt-4 pt-3" />

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-[11px] text-text-muted">Save cover.jpg separately</p>
            <p className="text-[9px] text-text-muted">
              Save highest-quality cover next to audio files
            </p>
          </div>
          <Toggle
            enabled={saveCover}
            onChange={(v) => {
              setSaveCover(v)
              update('save_artwork', v)
            }}
          />
        </div>

        {saveCover && (
          <div className="mt-3 animate-fade-in">
            <label className={sublabel}>Saved cover max width</label>
            <SelectRow value={savedWidth} />
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
            <div className="text-[10px] text-text-muted">
              Signed in &middot; Ready to download
            </div>
          </div>
          <button
            onClick={signOut}
            className="h-7 px-3.5 border border-red-500 text-red-500 rounded text-[10px] hover:bg-red-500/10 transition flex-shrink-0"
          >
            Sign Out
          </button>
        </div>
        <SelectRow value="🐙 Add another Qobuz account" />
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
          <span className="text-[10px] text-purple-light cursor-pointer select-none">
            Check ▸
          </span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-[11px] text-text-muted">Licenses</span>
          <span className="text-[10px] text-purple-light cursor-pointer select-none">
            View ▸
          </span>
        </div>
      </section>
    </div>
  )
}
