import { useState, useEffect, useRef } from 'react'
import Toggle from '../components/Toggle'
import { API_BASE } from '../App'
import { useI18n } from '../i18n'

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

// Template tokens are the wire format (English) — in Chinese mode the UI
// shows localized token names but stores/sends the English originals.
const TOKEN_ZH: Record<string, string> = {
  '{track}': '{音轨}',
  '{title}': '{歌名}',
  '{artist}': '{歌手}',
  '{album}': '{专辑}',
  '{year}': '{年份}',
  '{bit_depth}': '{位深}',
}
const TOKEN_ZH_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(TOKEN_ZH).map(([en, zh]) => [zh, en]),
)

function templateToDisplay(template: string, lang: 'en' | 'zh'): string {
  if (lang === 'en') return template
  return template.replace(/\{(track|title|artist|album|year|bit_depth)\}/g, (m) => TOKEN_ZH[m] ?? m)
}

function displayToTemplate(display: string, lang: 'en' | 'zh'): string {
  if (lang === 'en') return display
  return display.replace(/\{[^}]+\}/g, (m) => TOKEN_ZH_REVERSE[m] ?? m)
}

// Split a template into units (a {token} or a separator chunk) and drop
// the last one — deletes whole tokens instead of one character at a time.
function deleteLastUnit(template: string): string {
  const parts = template.split(/(\{[^}]*\})/).filter(Boolean)
  if (parts.length === 0) return ''
  parts.pop()
  return parts.join('')
}

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
        <span className="text-lg text-text-primary">{value}</span>
        <span className="text-base text-purple-light">▾</span>
      </div>
      {open && (
        <div className="absolute z-10 mt-1 w-full bg-bg-input border border-border rounded-lg shadow-lg overflow-hidden">
          {options.map((o) => (
            <div key={o} onClick={() => { onSelect(o); onToggle() }}
              className={`px-3 py-2 text-base cursor-pointer hover:bg-purple-ghost transition-colors ${o === value ? 'text-purple-light' : 'text-text-secondary'}`}
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
  const { t, lang, setLang } = useI18n()
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
  const [customOpen, setCustomOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [templateError, setTemplateError] = useState(false)

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

  const sectionTitle = 'text-[13px] font-semibold text-purple-light tracking-wider mb-3.5 uppercase'
  const sublabel = 'text-sm text-text-muted block mb-1'

  const currentQuality = QUALITY_TIERS[qualityIdx]?.label || QUALITY_TIERS[3].label

  return (
    <div className="p-5 animate-fade-in h-full">
      {/* GENERAL */}
      <section className="mb-7">
        <h2 className={sectionTitle}>{t('set.general')}</h2>
        <div className="mb-3">
          <label className={sublabel}>{t('set.language')}</label>
          <Dropdown
            value={lang === 'zh' ? '中文' : 'English'}
            options={['English', '中文']}
            open={langOpen} onToggle={() => setLangOpen(!langOpen)}
            onSelect={(v) => setLang(v === '中文' ? 'zh' : 'en')}
          />
        </div>
      </section>

      {/* DOWNLOAD */}
      <section className="mb-7">
        <h2 className={sectionTitle}>{t('set.download')}</h2>

        <div className="mb-3">
          <label className={sublabel}>{t('set.baseFolder')}</label>
          <div className="flex gap-2">
            <input value={folder} onChange={(e) => { setFolder(e.target.value); update('download_folder', e.target.value) }}
              className="flex-1 h-10 bg-bg-input border border-border rounded-lg px-2.5 text-sm text-text-secondary font-mono outline-none focus:border-purple"
            />
            <button
              onClick={async () => {
                if (window.electronAPI?.pickFolder) {
                  const path = await window.electronAPI.pickFolder()
                  if (path) { setFolder(path); update('download_folder', path) }
                }
              }}
              className="w-9 h-10 bg-bg-input border border-border rounded-lg flex items-center justify-center text-lg hover:border-text-muted transition flex-shrink-0">📂</button>
          </div>
        </div>

        <div className="mb-3">
          <label className={sublabel}>{t('set.quality')}</label>
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
          <label className={sublabel}>{t('set.folderStruct')}</label>
          <Dropdown
            value={templateToDisplay(folderFmt, lang)}
            options={FOLDER_PRESETS.map((p) => templateToDisplay(p, lang))}
            open={folderOpen} onToggle={() => setFolderOpen(!folderOpen)}
            onSelect={(v) => {
              const real = displayToTemplate(v, lang)
              setFolderFmt(real)
              update('folder_format', real)
            }}
          />
          <p className="text-[13px] text-text-muted mt-1.5">
            {t('set.preview')} <TemplatePreview template={folderFmt} type="folder" />
          </p>
        </div>

        <div className="bg-bg-card/30 border border-border rounded-xl p-3.5">
          <div className="flex justify-between items-center mb-1">
            <label className={sublabel}>{t('set.fileNameTemplate')}</label>
            <button
              onClick={() => {
                // Closing with an invalid (empty / token-less) template
                // must fail the same validation as saving.
                if (customOpen && !/\{[a-z_]+\}/.test(fileFmt)) {
                  setTemplateError(true)
                  return
                }
                setCustomOpen(!customOpen)
              }}
              className="text-[13px] text-purple-light cursor-pointer select-none hover:text-purple transition-colors"
            >
              {customOpen ? t('set.customClose') : t('set.customOpen')}
            </button>
          </div>
          <Dropdown
            value={templateToDisplay(fileFmt, lang)}
            options={FILE_PRESETS.map((p) => templateToDisplay(p, lang))}
            open={fileOpen} onToggle={() => setFileOpen(!fileOpen)}
            onSelect={(v) => {
              const real = displayToTemplate(v, lang)
              setFileFmt(real)
              update('track_format', real)
            }}
          />
          {customOpen && (
            <div className="mt-3 p-3 bg-bg-input/50 border border-border rounded-lg animate-fade-in">
              <p className="text-[13px] text-text-muted mb-2">{t('set.tokens')}</p>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {['{track}', '{title}', '{artist}', '{album}', '{year}', '{bit_depth}'].map((tk) => (
                  <button
                    key={tk}
                    onClick={() => setFileFmt((fileFmt + tk).replace('}{', '} {'))}
                    className="px-2 py-0.5 bg-purple-ghost text-purple-light rounded-full text-[13px] font-medium hover:bg-purple hover:text-white transition-colors"
                  >{templateToDisplay(tk, lang)}</button>
                ))}
              </div>
              <p className="text-[13px] text-text-muted mb-2">{t('set.separators')}</p>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {[' — ', '.', '/', '(', ')', ' '].map((s) => (
                  <button
                    key={s}
                    onClick={() => setFileFmt(fileFmt + s)}
                    className="px-2 py-0.5 bg-bg-input border border-border text-text-secondary rounded-full text-[13px] hover:border-purple hover:text-purple-light transition-colors"
                  >{s.trim() === '' ? '␣' : s}</button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setFileFmt(deleteLastUnit(fileFmt))}
                  className="flex-1 h-9 bg-bg-input border border-border rounded text-[13px] text-text-secondary hover:border-text-muted transition-colors"
                >{t('set.deleteLast')}</button>
                <button
                  onClick={() => {
                    // Valid template: non-empty AND contains at least one token
                    if (!/\{[a-z_]+\}/.test(fileFmt)) {
                      setTemplateError(true)
                      return
                    }
                    setTemplateError(false)
                    update('track_format', fileFmt)
                    setCustomOpen(false)
                  }}
                  className="flex-1 h-9 bg-purple text-white rounded text-[13px] font-medium hover:bg-[#6d28d9] transition-colors"
                >{t('set.saveTemplate')}</button>
              </div>
              {templateError && (
                <p className="text-red-500 text-[13px] mt-2 animate-fade-in">
                  {t('set.templateEmpty')}
                </p>
              )}
            </div>
          )}
          <p className="text-[13px] text-text-muted mt-1.5">
            {t('set.preview')} <TemplatePreview template={fileFmt} type="file" />
          </p>
        </div>
      </section>

      {/* ARTWORK */}
      <section className="mb-7">
        <h2 className={sectionTitle}>{t('set.artwork')}</h2>

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-sm text-text-secondary">{t('set.embedCover')}</p>
            <p className="text-[13px] text-text-muted">{t('set.embedCoverHint')}</p>
          </div>
          <Toggle enabled={embedCover} onChange={(v) => { setEmbedCover(v); update('embed_cover', v) }} />
        </div>

        <div className={embedCover ? 'mb-3' : 'mb-3 opacity-35 pointer-events-none'}>
          <label className={`${sublabel} mt-1`}>{t('set.embedSize')}</label>
          <Dropdown value={embedSize} options={EMBED_SIZES}
            open={embedSizeOpen} onToggle={() => setEmbedSizeOpen(!embedSizeOpen)}
            onSelect={(v) => { setEmbedSize(v); update('embed_size', v) }}
          />
        </div>

        <div className="border-t border-border mt-4 pt-3" />

        <div className="flex items-center justify-between py-2.5 border-b border-white/[0.02]">
          <div>
            <p className="text-sm text-text-muted">{t('set.saveCover')}</p>
            <p className="text-[13px] text-text-muted">{t('set.saveCoverHint')}</p>
          </div>
          <Toggle enabled={saveCover} onChange={(v) => { setSaveCover(v); update('save_artwork', v) }} />
        </div>

        {saveCover && (
          <div className="mt-3 animate-fade-in">
            <label className={sublabel}>{t('set.savedWidth')}</label>
            <Dropdown value={savedWidth} options={SAVED_WIDTHS}
              open={savedWidthOpen} onToggle={() => setSavedWidthOpen(!savedWidthOpen)}
              onSelect={(v) => { setSavedWidth(v); update('saved_max_width', v) }}
            />
          </div>
        )}
      </section>

      {/* ACCOUNT */}
      <section className="mb-7">
        <h2 className={sectionTitle}>{t('set.account')}</h2>
        <div className="bg-bg-card/40 border border-border rounded-xl p-3.5 flex items-center gap-2.5 mb-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-quality flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm text-text-primary">{t('set.connected')}</div>
            <div className="text-[13px] text-text-muted">{t('set.signedIn')}</div>
          </div>
          <button onClick={signOut}
            className="h-9 px-3.5 border border-red-500 text-red-500 rounded text-[13px] hover:bg-red-500/10 transition flex-shrink-0"
          >{t('set.signOut')}</button>
        </div>
      </section>

      {/* ABOUT */}
      <section>
        <h2 className={sectionTitle}>{t('set.about')}</h2>
        <div className="flex justify-between items-center py-2 border-b border-white/[0.02]">
          <span className="text-sm text-text-muted">{t('set.version')}</span>
          <span className="text-sm text-text-secondary">0.1.0</span>
        </div>
        <div className="flex justify-between items-center py-2 border-b border-white/[0.02]">
          <span className="text-sm text-text-muted">{t('set.checkUpdates')}</span>
          <span
            className="text-[13px] text-purple-light cursor-pointer select-none hover:text-text-primary transition"
            onClick={() => window.electronAPI?.openExternal('https://github.com/zyw0815/Qrip')}
          >
            {t('set.check')}
          </span>
        </div>
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-text-muted">{t('set.author')}</span>
          <span
            className="text-[13px] text-purple-light cursor-pointer select-none hover:text-text-primary transition"
            onClick={() => window.electronAPI?.openExternal('https://github.com/zyw0815')}
          >
            zyw0815 ▸
          </span>
        </div>
      </section>
    </div>
  )
}
