export default function SelectRow({
  value,
  onClick,
}: {
  value: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className="px-3 py-2 bg-bg-input border border-border rounded-lg flex justify-between items-center cursor-pointer hover:border-text-muted transition-colors"
    >
      <span className="text-sm text-text-primary">{value}</span>
      <span className="text-xs text-purple-light">▾</span>
    </div>
  )
}
