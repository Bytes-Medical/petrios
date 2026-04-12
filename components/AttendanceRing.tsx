interface AttendanceRingProps {
  percentage: number
  size?: number
  strokeWidth?: number
}

export function AttendanceRing({ percentage, size = 140, strokeWidth = 10 }: AttendanceRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference

  const color =
    percentage >= 80 ? '#22c55e' : percentage >= 60 ? '#eab308' : '#ef4444'

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-700"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-black"
        style={{
          fontSize: size * 0.22,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          transform: 'rotate(90deg)',
          transformOrigin: `${size / 2}px ${size / 2}px`,
        }}
      >
        {percentage}%
      </text>
    </svg>
  )
}
