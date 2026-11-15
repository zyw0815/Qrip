import { useCallback, useRef, useState } from 'react'
import TabBar, { type Tab } from '../components/TabBar'
import SearchTab from './SearchTab'
import DownloadsTab, { type DownloadActivity } from './DownloadsTab'
import SettingsTab from './SettingsTab'
import { useI18n } from '../i18n'

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState('search')
  const [activity, setActivity] = useState<DownloadActivity>({
    active: 0, queued: 0, busyIds: new Set(),
  })
  const [refreshKey, setRefreshKey] = useState(0)
  const downloadsButton = useRef<HTMLButtonElement>(null)
  const { t } = useI18n()

  const refreshDownloads = useCallback(() => setRefreshKey((value) => value + 1), [])
  const updateActivity = useCallback((next: DownloadActivity) => {
    setActivity((previous) => (
      next.active === previous.active && next.queued === previous.queued &&
      next.busyIds.size === previous.busyIds.size &&
      [...next.busyIds].every((id) => previous.busyIds.has(id))
        ? previous : next
    ))
  }, [])

  const showQueued = useCallback((origin: DOMRect) => {
    refreshDownloads()
    const target = downloadsButton.current
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const destination = target.getBoundingClientRect()
    const x = origin.left + origin.width / 2
    const y = origin.top + origin.height / 2
    const dx = destination.right - 22 - x
    const dy = destination.top + destination.height / 2 - y
    const icon = document.createElement('span')
    icon.setAttribute('aria-hidden', 'true')
    icon.className = 'pointer-events-none fixed z-50 grid place-items-center w-7 h-7 rounded-full bg-purple text-white shadow-lg'
    icon.style.left = `${x - 14}px`
    icon.style.top = `${y - 14}px`
    icon.textContent = '↓'
    document.body.append(icon)
    const flight = icon.animate([
      { transform: 'translate(0, 0) scale(0.75)', opacity: 0.85 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) scale(1)`, opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: 0 },
    ], { duration: 430, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' })
    void flight.finished.then(() => {
      icon.remove()
      target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
        { duration: 180 })
    }, () => icon.remove())
  }, [refreshDownloads])

  const TABS: Tab[] = [
    { key: 'search', label: t('tab.search') },
    {
      key: 'downloads',
      label: t('tab.downloads'),
      badge: activity.active > 0 ? activity.active : undefined,
      description: activity.active || activity.queued
        ? t('tab.downloadActivity', { active: activity.active, queued: activity.queued })
        : undefined,
      buttonRef: downloadsButton,
    },
    { key: 'settings', label: t('tab.settings') },
  ]

  const bgStyle = {
    backgroundImage:
      'radial-gradient(ellipse at 30% 0%, rgba(124,58,237,0.06) 0%, transparent 50%)',
  }

  return (
    <div className="h-screen bg-bg-deep flex flex-col overflow-hidden" style={bgStyle}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2 flex-shrink-0">
        <h1 className="text-3xl font-bold tracking-[-0.3px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent select-none">
          Qrip
        </h1>
        <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content — all tabs stay mounted; CSS toggles visibility
          so search results, download polling, and loaded settings survive
          tab switches */}
      <div className="flex-1 scroll-stable">
        <div className={activeTab === 'search' ? '' : 'hidden'}>
          <SearchTab busyIds={activity.busyIds} onQueued={showQueued} />
        </div>
        <div className={activeTab === 'downloads' ? '' : 'hidden'}>
          <DownloadsTab refreshKey={refreshKey} onActivityChange={updateActivity} onRefresh={refreshDownloads} />
        </div>
        <div className={activeTab === 'settings' ? '' : 'hidden'}>
          <SettingsTab />
        </div>
      </div>
    </div>
  )
}
