export default function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`w-[38px] h-[21px] rounded-full transition-colors relative flex-shrink-0 ${
        enabled ? 'bg-purple' : 'bg-[#3a3a4a] border border-[#4a4a5a]'
      }`}
      aria-label={enabled ? 'Enabled' : 'Disabled'}
    >
      <div
        className={`w-[17px] h-[17px] rounded-full absolute top-[1px] transition-all ${
          enabled ? 'left-[19px] bg-white' : 'left-[1px] bg-[#6a6a7a]'
        }`}
      />
    </button>
  )
}
