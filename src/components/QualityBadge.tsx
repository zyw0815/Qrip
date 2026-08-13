export default function QualityBadge({ label }: { label: string }) {
  return (
    <span className="text-[12px] px-2 py-0.5 rounded bg-green-900/20 text-green-quality font-medium">
      {label}
    </span>
  )
}
