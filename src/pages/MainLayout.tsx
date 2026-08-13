import { useState } from 'react'
import TabBar, { type Tab } from '../components/TabBar'
import SearchTab from './SearchTab'
import DownloadsTab from './DownloadsTab'
import SettingsTab from './SettingsTab'

const TABS: Tab[] = [
  { key: 'search', label: 'Search' },
  { key: 'downloads', label: 'Downloads' },
  { key: 'settings', label: 'Settings' },
]

export default function MainLayout() {
  const [activeTab, setActiveTab] = useState('search')

  const bgStyle = {
    backgroundImage:
      'radial-gradient(ellipse at 30% 0%, rgba(124,58,237,0.06) 0%, transparent 50%)',
  }

  return (
    <div className="h-screen bg-bg-deep flex flex-col overflow-hidden" style={bgStyle}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-[-0.3px] bg-gradient-to-r from-purple-light to-purple bg-clip-text text-transparent select-none">
          Qrip
        </h1>
        <TabBar tabs={TABS} active={activeTab} onChange={setActiveTab} />
      </div>

      {/* Tab content */}
      <div className="flex-1 scroll-stable" key={activeTab}>
        {activeTab === 'search' && <SearchTab />}
        {activeTab === 'downloads' && <DownloadsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}
