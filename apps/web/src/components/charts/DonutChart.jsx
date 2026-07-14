'use client';

import styles from './DonutChart.module.css';

export function DonutChart({ segments = [], size = 160 }) {
  const total = Math.max(1, segments.reduce((sum, s) => sum + s.value, 0));
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className={styles.wrap}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.svg}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(15,23,40,0.08)"
          strokeWidth={stroke}
        />
        {segments.map((seg) => {
          const length = (seg.value / total) * circumference;
          const circle = (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += length;
          return circle;
        })}
        <text x="50%" y="48%" textAnchor="middle" className={styles.centerValue}>
          {segments.reduce((s, x) => s + x.value, 0)}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className={styles.centerLabel}>
          outcomes
        </text>
      </svg>
      <ul className={styles.legend}>
        {segments.map((seg) => (
          <li key={seg.label}>
            <span style={{ background: seg.color }} />
            {seg.label}
            <strong>{seg.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
