export default function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="h-1 bg-bg-input rounded-sm overflow-hidden">
      <div
        className="h-full rounded-sm bg-gradient-to-r from-purple to-purple-light transition-all duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
