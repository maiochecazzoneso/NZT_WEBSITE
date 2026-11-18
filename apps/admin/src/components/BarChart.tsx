import type { DayDownloads } from '../api/types';
import { barLayout, shortDay, sumCounts } from '../lib/stats';

/** Grafico a barre in SVG inline (nessuna libreria, nessuno style inline: CSP-safe). */
export function BarChart({ points, label }: { points: DayDownloads[]; label: string }) {
  const layout = barLayout(points, { width: 560, height: 140 });
  const labelEvery = points.length > 7 ? 2 : 1;
  const total = sumCounts(points);
  const summary = `${label}: ${total} in ${points.length} giorni, massimo ${layout.max} al giorno.`;
  return (
    <figure className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 -16 ${layout.width} ${layout.height + 40}`}
        className="h-auto w-full text-white"
      >
        <title>{summary}</title>
        <line
          x1="0"
          x2={layout.width}
          y1={layout.height}
          y2={layout.height}
          stroke="currentColor"
          strokeOpacity="0.2"
        />
        <text
          x="0"
          y="-4"
          fill="currentColor"
          fillOpacity="0.6"
          fontSize="11"
          fontFamily="var(--font-mono)"
        >
          max {layout.max}
        </text>
        {layout.bars.map((bar, index) => (
          <g key={bar.day}>
            <rect
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx="2"
              fill="currentColor"
              fillOpacity={bar.count > 0 ? 0.85 : 0.1}
            >
              <title>{`${shortDay(bar.day)}: ${bar.count}`}</title>
            </rect>
            {bar.count === 0 ? (
              <rect
                x={bar.x}
                y={layout.height - 2}
                width={bar.width}
                height="2"
                fill="currentColor"
                fillOpacity="0.25"
              />
            ) : null}
            {index % labelEvery === 0 || index === layout.bars.length - 1 ? (
              <text
                x={bar.x + bar.width / 2}
                y={layout.height + 16}
                textAnchor="middle"
                fill="currentColor"
                fillOpacity="0.6"
                fontSize="10"
                fontFamily="var(--font-mono)"
              >
                {shortDay(bar.day)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
