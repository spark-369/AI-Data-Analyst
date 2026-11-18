"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, BarChart3, Database, Gauge, MessagesSquare } from "lucide-react";

import { ChartRenderer } from "@/components/charts/chart-renderer";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

function StatCard({ icon: Icon, label, value, hint, loading, progress }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardDescription>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <div className="text-2xl font-semibold">{value}</div>
        )}
        {loading ? (
          <Skeleton className="mt-2 h-3 w-32" />
        ) : hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
        {typeof progress === "number" ? (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [overview, recent] = await Promise.all([api.overview(), api.recentCharts(8)]);
        if (!cancelled) {
          setStats(overview);
          setCharts(recent);
        }
      } catch {
        /* stats are non-critical */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxTableCount = stats?.top_tables?.length ? stats.top_tables[0].count : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <PageHeader
        title="Dashboard"
        description="Usage overview of your autonomous analyst."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/datasources">
                <Database className="h-4 w-4" /> Data sources
              </Link>
            </Button>
            <Button asChild>
              <Link href="/chat">
                <MessagesSquare className="h-4 w-4" /> Ask a question
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={MessagesSquare}
          label="Questions asked"
          value={stats ? stats.total_questions.toLocaleString() : "0"}
          hint={stats ? `${stats.total_conversations} conversations` : null}
          loading={!stats}
        />
        <StatCard
          icon={Activity}
          label="Success rate"
          value={stats ? `${stats.success_rate}%` : "—"}
          hint={stats ? `${stats.successful} successful · ${stats.failed} failed` : null}
          loading={!stats}
          progress={stats ? stats.success_rate : undefined}
        />
        <StatCard
          icon={Gauge}
          label="Avg. latency"
          value={stats ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
          hint="End-to-end pipeline"
          loading={!stats}
        />
        <StatCard
          icon={Database}
          label="Data sources"
          value={stats ? stats.total_datasources.toLocaleString() : "0"}
          hint="Connected databases"
          loading={!stats}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Most explored tables</CardTitle>
          <CardDescription>Tables the analyst queried most often.</CardDescription>
        </CardHeader>
        <CardContent>
          {!stats ? (
            <div className="space-y-3">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : stats.top_tables.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No queries yet"
              description="Once you ask questions in Chat, the explored tables show up here."
            />
          ) : (
            <div className="space-y-2.5">
              {stats.top_tables.map((entry) => (
                <div key={entry.table} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate font-mono text-xs">{entry.table}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.max(6, Math.round((entry.count / maxTableCount) * 100))}%`,
                      }}
                    />
                  </div>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {entry.count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Recent charts</CardTitle>
              <CardDescription>Latest visualizations generated by the analyst.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/chat">
                Open chat <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!charts ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-48 w-full" />
              ))}
            </div>
          ) : charts.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No charts yet"
              description="Open the Chat page and ask your first question."
              action={
                <Button asChild>
                  <Link href="/chat">Ask a question</Link>
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {charts.map((item) => (
                <a
                  key={item.message_id}
                  href={`/chat?c=${item.conversation_id}`}
                  className="group block space-y-2 rounded-xl border p-4 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-medium" title={item.question}>
                      {item.question}
                    </p>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.datasource_name || "Unknown source"} · {timeAgo(item.created_at)}
                  </p>
                  <ChartRenderer config={item.chart} rows={item.rows} height={200} />
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
