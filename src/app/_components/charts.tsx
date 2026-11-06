import { WEEKDAY_LABELS, intensityStep, type ArrivalGrid, type OnTimeGroup } from "@/modules/reports";
import {
  BAR_GAP,
  CHART_HEIGHT,
  CHART_WIDTH,
  PLOT,
  axisTicks,
  bandCenter,
  bandWidth,
  barWidth,
  columnPath,
  labelIndexes,
  linePath,
  lineRuns,
  niceMax,
  yOf,
} from "./chart-geometry";

// Server-rendered charts of the analytics (SPEC 2026-11-06-analises-operacionais, 5.7): SVG with
// no client script and no library. Every chart has a title, a native tooltip (<title>) on each
// mark and a table with the same numbers; text always uses the text colors, never the series
// color. One axis per chart: two measures are always two charts.

const numbers = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function formatValue(value: number, unit: "" | "%"): string {
  return `${numbers.format(value)}${unit}`;
}

function Axes({ max, unit, labels, count }: { max: number; unit: "" | "%"; labels: readonly string[]; count: number }) {
  return (
    <g className="chart-axes" aria-hidden="true">
      {axisTicks(max).map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={PLOT.left} x2={PLOT.left + PLOT.width} y1={yOf(tick, max)} y2={yOf(tick, max)} />
          <text className="chart-tick" x={PLOT.left - 6} y={yOf(tick, max)} dy="0.32em" textAnchor="end">
            {formatValue(tick, unit)}
          </text>
        </g>
      ))}
      {labelIndexes(count).map((index) => (
        <text key={index} className="chart-tick" x={bandCenter(index, count)} y={CHART_HEIGHT - 10} textAnchor="middle">
          {labels[index]}
        </text>
      ))}
    </g>
  );
}

function Figure({ id, title, note, children, table }: { id: string; title: string; note?: string; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <figure className="chart" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="chart-title">
        {title}
        {note ? <span className="metadata">{note}</span> : null}
      </figcaption>
      {children}
      <details className="chart-table">
        <summary>Ver os números em tabela</summary>
        {table}
      </details>
    </figure>
  );
}

export interface PairPoint {
  label: string;
  first: number;
  second: number;
}

/** Two counts side by side per interval, e.g. opened × completed (5.4). */
export function ColumnPairChart({
  id,
  title,
  note,
  points,
  names,
}: {
  id: string;
  title: string;
  note?: string;
  points: readonly PairPoint[];
  names: readonly [string, string];
}) {
  const max = niceMax(Math.max(0, ...points.flatMap((point) => [point.first, point.second])));
  const width = barWidth(points.length, 2);

  return (
    <Figure
      id={id}
      title={title}
      note={note}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Intervalo</th>
              <th scope="col">{names[0]}</th>
              <th scope="col">{names[1]}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{point.first}</td>
                <td>{point.second}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ul className="chart-legend">
        <li>
          <span className="chart-swatch chart-series-1" aria-hidden="true" />
          {names[0]}
        </li>
        <li>
          <span className="chart-swatch chart-series-2" aria-hidden="true" />
          {names[1]}
        </li>
      </ul>
      <svg className="chart-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby={`${id}-title`}>
        <Axes max={max} unit="" labels={points.map((point) => point.label)} count={points.length} />
        {points.map((point, index) => {
          const left = bandCenter(index, points.length) - width - BAR_GAP / 2;
          return (
            <g key={point.label}>
              <title>{`${point.label}: ${names[0]} ${point.first}, ${names[1]} ${point.second}`}</title>
              {/* Hit target wider than the marks, for the native tooltip. */}
              <rect className="chart-hit" x={bandCenter(index, points.length) - bandWidth(points.length) / 2} y={PLOT.top} width={bandWidth(points.length)} height={PLOT.height} />
              <path className="chart-series-1" d={columnPath(left, width, point.first, max)} />
              <path className="chart-series-2" d={columnPath(left + width + BAR_GAP, width, point.second, max)} />
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}

export interface LineChartPoint {
  label: string;
  value: number | null;
}

/** One measure over the intervals; empty values break the line (5.4). */
export function LineChart({
  id,
  title,
  note,
  points,
  unit = "",
  fixedMax,
  valueName,
}: {
  id: string;
  title: string;
  note?: string;
  points: readonly LineChartPoint[];
  unit?: "" | "%";
  fixedMax?: number;
  valueName: string;
}) {
  const values = points.map((point) => point.value);
  const max = fixedMax ?? niceMax(Math.max(0, ...values.map((value) => value ?? 0)));
  const runs = lineRuns(values, max);
  const last = runs.at(-1)?.at(-1);

  return (
    <Figure
      id={id}
      title={title}
      note={note}
      table={
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Intervalo</th>
              <th scope="col">{valueName}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                <td>{point.value === null ? "—" : formatValue(point.value, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <svg className="chart-svg" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby={`${id}-title`}>
        <Axes max={max} unit={unit} labels={points.map((point) => point.label)} count={points.length} />
        {runs.map((run) => (
          <path key={run[0]!.index} className="chart-line" d={linePath(run)} />
        ))}
        {runs.flat().map((point) => (
          <g key={point.index}>
            <title>{`${points[point.index]!.label}: ${formatValue(point.value, unit)}`}</title>
            <circle className="chart-hit" cx={point.x} cy={point.y} r={10} />
            <circle className="chart-dot" cx={point.x} cy={point.y} r={4} />
          </g>
        ))}
        {/* Only the last value is labelled; the axis, tooltips and table carry the rest. */}
        {last ? (
          <text
            className="chart-end-label"
            x={Math.min(last.x - 8, PLOT.left + PLOT.width - 8)}
            // Above the last point, or below it when the point is at the top of the plot.
            y={last.y - 10 >= PLOT.top + 8 ? last.y - 10 : last.y + 18}
            textAnchor="end"
          >
            {formatValue(last.value, unit)}
          </text>
        ) : null}
      </svg>
    </Figure>
  );
}

/** On-time share of groups (5.5.4): bar from 0 to 100 %, with the count and "poucos dados". */
export function PercentBars({ caption, groups }: { caption: string; groups: readonly OnTimeGroup[] }) {
  if (groups.length === 0) {
    return (
      <section className="dashboard-group" aria-label={caption}>
        <h3>{caption}</h3>
        <p className="metadata">Nenhuma concluída com prazo no período.</p>
      </section>
    );
  }

  return (
    <section className="dashboard-group" aria-label={caption}>
      <h3>{caption}</h3>
      <table className="dashboard-bars">
        <thead>
          <tr>
            <th scope="col">Nome</th>
            <th scope="col">No prazo</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.label}>
              <th scope="row">{group.label}</th>
              <td>
                <span className="dashboard-bar" aria-hidden="true">
                  <span style={{ width: `${group.percentage ?? 0}%` }} />
                </span>
                <span className="dashboard-bar-value">
                  {group.percentage}% ({group.onTime} de {group.withDueDate})
                  {group.fewData ? <span className="tag-muted"> poucos dados</span> : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Weekday × hour grid (5.5.5): one hue, darker with more requests; numbers in the tooltip and table. */
export function ArrivalHeatmap({ grid }: { grid: ArrivalGrid }) {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <figure className="chart" aria-labelledby="arrivals-title">
      <figcaption id="arrivals-title" className="chart-title">
        Quando as solicitações chegam
        <span className="metadata">Abertas no período, por dia da semana e hora (horário de Brasília). Mais escuro, mais solicitações.</span>
      </figcaption>
      {grid.total === 0 ? (
        <p className="metadata">Nenhuma solicitação aberta no período.</p>
      ) : (
        <div className="heatmap-scroll">
          <table className="heatmap">
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Dia</span>
                </th>
                {hours.map((hour) => (
                  <th key={hour} scope="col">
                    {hour % 3 === 0 ? `${hour}h` : <span className="visually-hidden">{`${hour}h`}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.cells.map((row, weekday) => (
                <tr key={WEEKDAY_LABELS[weekday]}>
                  <th scope="row">{WEEKDAY_LABELS[weekday]}</th>
                  {row.map((count, hour) => (
                    <td
                      key={hour}
                      className={`heat-${intensityStep(count, grid.largest)}`}
                      title={`${WEEKDAY_LABELS[weekday]}, ${hour}h: ${count}`}
                    >
                      <span className="visually-hidden">{count}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}
