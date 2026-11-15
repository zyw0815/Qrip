import type { Ref } from 'react'

export interface Tab {
  key: string
  label: string
  badge?: number
  description?: string
  buttonRef?: Ref<HTMLButtonElement>
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
          ref={t.buttonRef}
          onClick={() => onChange(t.key)}
          aria-label={t.description}
          title={t.description}
          className={`px-5 py-2 rounded-t-md text-lg font-medium transition-colors ${
            active === t.key
              ? 'text-purple-light bg-purple-ghost'
              : 'text-text-muted hover:text-text-secondary hover:bg-white/5'
          }`}
        >
          {t.label}
          {t.badge !== undefined && (
            <span
              aria-hidden="true"
              className="inline-flex min-w-5 h-5 items-center justify-center ml-2 px-1 rounded-full bg-purple text-white text-xs tabular-nums align-middle"
            >
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
