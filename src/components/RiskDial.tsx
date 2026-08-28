import { formatPercent, riskColor, riskLabel, riskLevel } from "@/lib/voxguard";

type Props = {
  value: number | null;
  active: boolean;
  level: number;
};

/** Big circular live risk indicator for the call screen. */
export function RiskDial({ value, active, level }: Props) {
  const pct = value ?? 0;
  const color = riskColor(riskLevel(pct));
  const radius = 86;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative mx-auto grid size-56 place-items-center">
      {active && (
        <span
          className="pulse-ring absolute inset-4 rounded-full border"
          style={{ borderColor: color, opacity: 0.5 }}
        />
      )}
      <span
        className="absolute inset-8 rounded-full transition-transform duration-150"
        style={{
          background: `radial-gradient(circle, color-mix(in oklab, ${color} 30%, transparent), transparent 70%)`,
          transform: `scale(${0.85 + level * 0.35})`,
        }}
      />
      <svg viewBox="0 0 200 200" className="size-56 -rotate-90">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--color-border)" strokeWidth="10" />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute text-center">
        <p className="font-mono text-4xl font-semibold" style={{ color }}>
          {value === null ? "--" : formatPercent(pct, 0)}
        </p>
        <p className="label-mono mt-1">AI probability</p>
        <p className="mt-3 text-sm font-semibold" style={{ color }}>
          {value === null ? "AWAITING FIRST WINDOW" : riskLabel(pct)}
        </p>
      </div>
    </div>
  );
}
