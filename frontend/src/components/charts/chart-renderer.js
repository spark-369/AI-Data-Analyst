"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = [
  "#6366f1",
  "#22d3ee",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#0ea5e9",
  "#f43f5e",
];

const axisProps = { tickLine: false, axisLine: false, tick: { fontSize: 11 } };

function formatNumber(value) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  return String(value ?? "");
}

function trimLabel(value) {
  const text = String(value ?? "");
  return text.length > 14 ? `${text.slice(0, 13)}…` : text;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildPieData(rows, xKey, yKey) {
  const mapped = rows.map((row) => ({
    name: String(row[xKey] ?? "—"),
    value: toNumber(row[yKey]),
  }));
  if (mapped.length <= 8) return mapped;
  const sorted = [...mapped].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7).reduce((sum, item) => sum + item.value, 0);
  return [...top, { name: "Other", value: rest }];
}

function formatCell(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatNumber(value);
  return String(value);
}

function MiniTable({ rows, keys }) {
  const limited = rows.slice(0, 12);
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {keys.map((key) => (
              <th key={key} className="px-3 py-2 text-left font-medium text-muted-foreground">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limited.map((row, index) => (
            <tr key={index} className="border-t">
              {keys.map((key) => (
                <td key={key} className="px-3 py-1.5">
                  {formatCell(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartRenderer({ config, rows, height = 280 }) {
  if (!rows || rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
        style={{ height }}
      >
        No data to visualize
      </div>
    );
  }

  const keys = Object.keys(rows[0]);
  const xKey = config?.x && keys.includes(config.x) ? config.x : keys[0];
  let yKeys = Array.isArray(config?.y)
    ? config.y.filter((key) => keys.includes(key) && key !== xKey)
    : [];
  if (yKeys.length === 0) {
    yKeys = keys.filter((key) => key !== xKey).slice(0, 3);
  }

  let type = config?.type || "bar";
  if (type !== "table" && yKeys.length === 0) type = "table";

  if (type === "table") {
    return <MiniTable rows={rows} keys={keys} />;
  }

  if (type === "pie") {
    const pieData = buildPieData(rows, xKey, yKeys[0]);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={pieData}
            dataKey="value"
            nameKey="name"
            innerRadius="45%"
            outerRadius="80%"
            paddingAngle={2}
          >
            {pieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => formatNumber(value)} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey={xKey}
            type="number"
            tickFormatter={(value) => formatNumber(value)}
            {...axisProps}
          />
          <YAxis tickFormatter={(value) => formatNumber(value)} width={56} {...axisProps} />
          <Tooltip formatter={(value) => formatNumber(value)} />
          <Scatter data={rows} dataKey={yKeys[0]} fill={COLORS[0]} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (type === "line" || type === "area") {
    const ChartComponent = type === "line" ? LineChart : AreaChart;
    const Series = type === "line" ? Line : Area;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ChartComponent data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={trimLabel} {...axisProps} />
          <YAxis tickFormatter={(value) => formatNumber(value)} width={56} {...axisProps} />
          <Tooltip formatter={(value) => formatNumber(value)} />
          {yKeys.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
          {yKeys.map((key, index) => (
            <Series
              key={key}
              type="monotone"
              dataKey={key}
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
              fillOpacity={type === "area" ? 0.25 : 1}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </ChartComponent>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={trimLabel}
          interval="preserveStartEnd"
          {...axisProps}
        />
        <YAxis tickFormatter={(value) => formatNumber(value)} width={56} {...axisProps} />
        <Tooltip formatter={(value) => formatNumber(value)} cursor={{ fill: "var(--accent)" }} />
        {yKeys.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
        {yKeys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            fill={COLORS[index % COLORS.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

