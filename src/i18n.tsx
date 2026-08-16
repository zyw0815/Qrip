import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'zh'

const translations: Record<Lang, Record<string, string>> = {
  en: {
    // App / shell
    'app.starting': 'Starting up…',

    // Tabs
    'tab.search': 'Search',
    'tab.downloads': 'Downloads',
    'tab.settings': 'Settings',

    // Login
    'login.subtitle': 'Sign in to start downloading',
    'login.popup': 'Sign in with Qobuz',
    'login.opening': 'Opening...',
    'login.popupHintElectron': 'Opens the Qobuz sign-in window — any login method works',
    'login.popupHintBrowser': 'Popup login is only available in the desktop app. Use Token login below.',
    'login.or': 'or',
    'login.tokenLink': 'Sign in with Token ▾',
    'login.tokenPlaceholder': 'Paste your Qobuz auth token...',
    'login.authenticating': 'Authenticating...',
    'login.tokenBtn': 'Authenticate with Token',
    'login.errClosed': 'OAuth window closed without completing login',
    'login.errFlow': 'OAuth flow failed',
    'login.errConn': 'Connection failed. Is the backend running?',
    'login.errInvalid': 'Invalid token',
    'login.errFailed': 'Login failed',

    // Search
    'search.urlTab': '🔗 URL',
    'search.searchTab': '🔍 Search',
    'search.pasteLabel': 'Paste a Qobuz link',
    'search.searchLabel': 'Search Qobuz',
    'search.searchPlaceholder': 'Artist, album, or track name...',
    'search.supported': 'Supported Links',
    'search.trackLink': '🎵 Track:',
    'search.albumLink': '💿 Album:',
    'search.playlistLink': '📋 Playlist:',
    'search.filterAll': 'All',
    'search.filterAlbums': '💿 Albums',
    'search.filterTracks': '🎵 Tracks',
    'search.filterPlaylists': '📋 Playlists',
    'search.working': 'Working...',
    'search.resolve': 'Resolve ▸',
    'search.searchBtn': 'Search ▸',
    'search.loadMore': 'Load more ({n} left) ▾',
    'search.loadingMore': 'Loading...',
    'search.errResolve': 'Failed to resolve URL',
    'search.errSearch': 'Search failed',
    'search.errConn': 'Backend connection failed',
    'search.errAdd': 'Failed to add to download queue',
    'search.errTracks': 'Failed to load tracks',
    'search.metaTracks': '{n} tracks',

    // Downloads
    'dl.empty': 'No downloads yet',
    'dl.emptyHint': 'Search for music or paste a URL to get started',
    'dl.downloading': 'Downloading — {n} active',
    'dl.queued': 'Queued',
    'dl.pausedLabel': '⏸ Paused',
    'dl.pause': '⏸ Pause',
    'dl.resume': '▶ Resume',
    'dl.delete': '✕ Delete',

    // Settings
    'set.general': 'General',
    'set.language': 'Language',
    'set.download': 'Download',
    'set.baseFolder': 'Base download folder',
    'set.quality': 'Audio quality',
    'set.folderStruct': 'Folder structure',
    'set.fileNameTemplate': 'File name template',
    'set.customOpen': '+ Custom ▸',
    'set.customClose': '✕ Close',
    'set.tokens': 'TOKENS',
    'set.separators': 'SEPARATORS',
    'set.currentTemplate': 'CURRENT TEMPLATE',
    'set.deleteLast': '⌫ Delete Last',
    'set.saveTemplate': '✓ Save Template',
    'set.preview': 'Preview:',
    'set.artwork': 'Artwork',
    'set.embedCover': 'Embed cover in audio files',
    'set.embedCoverHint': 'Write cover art into FLAC metadata',
    'set.embedSize': 'Embedded cover size',
    'set.saveCover': 'Save cover.jpg separately',
    'set.saveCoverHint': 'Save highest-quality cover next to audio files',
    'set.savedWidth': 'Saved cover max width',
    'set.account': 'Account',
    'set.connected': 'Qobuz — Connected',
    'set.signedIn': 'Signed in · Ready to download',
    'set.signOut': 'Sign Out',
    'set.about': 'About',
    'set.version': 'Version',
    'set.checkUpdates': 'Check for updates',
    'set.check': 'Check ▸',
    'set.author': 'Author',

    // Search result card
    'card.download': 'Download',
    'card.view': 'View ▾',
    'card.hide': 'Hide ▴',
  },
  zh: {
    // App / shell
    'app.starting': '启动中…',

    // Tabs
    'tab.search': '搜索',
    'tab.downloads': '下载',
    'tab.settings': '设置',

    // Login
    'login.subtitle': '登录以开始下载',
    'login.popup': '登录 Qobuz',
    'login.opening': '打开中...',
    'login.popupHintElectron': '弹出 Qobuz 登录窗口 — 任意登录方式均可',
    'login.popupHintBrowser': '弹窗登录仅在桌面应用中可用，请使用下方 Token 登录。',
    'login.or': '或',
    'login.tokenLink': '使用 Token 登录 ▾',
    'login.tokenPlaceholder': '粘贴你的 Qobuz auth token...',
    'login.authenticating': '认证中...',
    'login.tokenBtn': 'Token 认证',
    'login.errClosed': 'OAuth 窗口关闭，未完成登录',
    'login.errFlow': 'OAuth 流程失败',
    'login.errConn': '连接失败，后端是否在运行？',
    'login.errInvalid': 'Token 无效',
    'login.errFailed': '登录失败',

    // Search
    'search.urlTab': '🔗 链接',
    'search.searchTab': '🔍 搜索',
    'search.pasteLabel': '粘贴 Qobuz 链接',
    'search.searchLabel': '搜索 Qobuz',
    'search.searchPlaceholder': '艺人、专辑或曲目名称...',
    'search.supported': '支持的链接',
    'search.trackLink': '🎵 单曲：',
    'search.albumLink': '💿 专辑：',
    'search.playlistLink': '📋 歌单：',
    'search.filterAll': '全部',
    'search.filterAlbums': '💿 专辑',
    'search.filterTracks': '🎵 单曲',
    'search.filterPlaylists': '📋 歌单',
    'search.working': '处理中...',
    'search.resolve': '解析 ▸',
    'search.searchBtn': '搜索 ▸',
    'search.loadMore': '加载更多（还剩 {n}）▾',
    'search.loadingMore': '加载中...',
    'search.errResolve': 'URL 解析失败',
    'search.errSearch': '搜索失败',
    'search.errConn': '后端连接失败',
    'search.errAdd': '加入下载队列失败',
    'search.errTracks': '加载曲目失败',
    'search.metaTracks': '{n} 首',

    // Downloads
    'dl.empty': '还没有下载任务',
    'dl.emptyHint': '搜索音乐或粘贴链接开始下载',
    'dl.downloading': '下载中 — {n} 项',
    'dl.queued': '等待中',
    'dl.pausedLabel': '⏸ 已暂停',
    'dl.pause': '⏸ 暂停',
    'dl.resume': '▶ 继续',
    'dl.delete': '✕ 删除',

    // Settings
    'set.general': '通用',
    'set.language': '语言',
    'set.download': '下载',
    'set.baseFolder': '基础下载文件夹',
    'set.quality': '音质',
    'set.folderStruct': '文件夹结构',
    'set.fileNameTemplate': '文件名模板',
    'set.customOpen': '+ 自定义 ▸',
    'set.customClose': '✕ 关闭',
    'set.tokens': '占位符',
    'set.separators': '分隔符',
    'set.currentTemplate': '当前模板',
    'set.deleteLast': '⌫ 删除末位',
    'set.saveTemplate': '✓ 保存模板',
    'set.preview': '预览：',
    'set.artwork': '封面',
    'set.embedCover': '在音频文件中内嵌封面',
    'set.embedCoverHint': '将封面写入 FLAC 元数据',
    'set.embedSize': '内嵌封面尺寸',
    'set.saveCover': '单独保存 cover.jpg',
    'set.saveCoverHint': '在音频旁保存最高质量封面',
    'set.savedWidth': '保存的封面最大宽度',
    'set.account': '账号',
    'set.connected': 'Qobuz — 已连接',
    'set.signedIn': '已登录 · 可下载',
    'set.signOut': '退出登录',
    'set.about': '关于',
    'set.version': '版本',
    'set.checkUpdates': '检查更新',
    'set.check': '检查 ▸',
    'set.author': '作者',

    // Search result card
    'card.download': '下载',
    'card.view': '查看 ▾',
    'card.hide': '收起 ▴',
  },
}

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return localStorage.getItem('qrip-lang') === 'zh' ? 'zh' : 'en'
    } catch {
      return 'en'
    }
  })

  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('qrip-lang', l)
    } catch {
      // localStorage unavailable — language just won't persist
    }
  }

  const t = (key: string, vars?: Record<string, string | number>) => {
    let s = translations[lang][key] ?? translations.en[key] ?? key
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
    }
    return s
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
