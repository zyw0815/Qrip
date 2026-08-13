export interface Tab {
  key: string
  label: string
}

export default function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex gap-0.5 pt-3 pb-0 border-b border-white/5">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-5 py-2 rounded-t-md text-lg font-medium transition-colors ${
            active === t.key
              ? 'text-purple-light bg-purple-ghost'
              : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
