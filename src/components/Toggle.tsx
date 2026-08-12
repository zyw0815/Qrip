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
        enabled ? 'bg-purple' : 'bg-[#2a2a40]'
      }`}
      aria-label={enabled ? 'Enabled' : 'Disabled'}
    >
      <div
        className={`w-[17px] h-[17px] bg-white rounded-full absolute top-0.5 transition-all ${
          enabled ? 'left-[19px]' : 'left-[0.5px]'
        }`}
      />
    </button>
  )
}
