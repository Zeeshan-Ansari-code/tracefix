'use client';

import styles from './BarChart.module.css';

export function BarChart({ points = [], height = 180 }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const barWidth = 30;
  const gap = 16;
  const width = Math.max(points.length * (barWidth + gap) + 24, 240);
  const topPad = 22;
  const bottomPad = 28;
  const plotHeight = height - topPad - bottomPad;

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.svg} role="img" aria-label="Sessions by day">
        {points.map((point, index) => {
          const h = (point.value / max) * (plotHeight - 4);
          const x = 14 + index * (barWidth + gap);
          const y = topPad + (plotHeight - h);
          return (
            <g key={point.key || point.label}>
              <rect x={x} y={y} width={barWidth} height={Math.max(h, 3)} rx="8" className={styles.bar} />
              <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" className={styles.label}>
                {point.label}
              </text>
              {point.value > 0 ? (
                <text x={x + barWidth / 2} y={y - 6} textAnchor="middle" className={styles.value}>
                  {point.value}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
