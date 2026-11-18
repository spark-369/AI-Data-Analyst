"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ChartRenderer } from "@/components/charts/chart-renderer";
import { DataTable } from "@/components/data-table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, timeAgo } from "@/lib/utils";

const STEP_LABELS = {
  schema: "Schema context",
  sql_generation: "SQL generation (Ollama)",
  guardrails: "Guardrails (SQLGlot)",
  execution: "Execution",
  analysis: "Analysis & insight",
};

// The backend records both a "started" and a "done" entry per step; keep only
// the final state of each (step, attempt) pair so the trace shows one row
// per step instead of duplicated labels.
function dedupeSteps(steps) {
  const byKey = new Map();
  for (const step of steps || []) {
    byKey.set(`${step.step}#${step.attempt || 1}`, step);
  }
  return Array.from(byKey.values());
}

function PipelineStepRow({ step }) {
  const iconClass =
    step.status === "done"
      ? "text-emerald-500"
      : step.status === "error"
        ? "text-red-500"
        : "animate-spin text-muted-foreground";
  return (
    <li className="flex items-start gap-2 text-sm">
      {step.status === "done" ? (
        <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
      ) : step.status === "error" ? (
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
      ) : (
        <Loader2 className={cn("mt-0.5 h-4 w-4 shrink-0", iconClass)} />
      )}
      <div className="min-w-0">
        <span className="font-medium">{STEP_LABELS[step.step] || step.step}</span>
        {step.attempt > 1 ? (
          <span className="ml-1 text-xs text-muted-foreground">attempt {step.attempt}</span>
        ) : null}
        {step.latency_ms ? (
          <span className="ml-1 text-xs text-muted-foreground">· {step.latency_ms} ms</span>
        ) : null}
        {step.detail ? (
          <p className="break-all font-mono text-xs text-muted-foreground">{step.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

import { Bot } from "lucide-react";

function MessageBadges({ message }) {
  const isError = message.status === "error";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={isError ? "destructive" : "success"}>{isError ? "Failed" : "Answer"}</Badge>
      {!isError && typeof message.row_count === "number" ? (
        <Badge variant="secondary">
          {message.row_count.toLocaleString()} {message.row_count === 1 ? "row" : "rows"}
        </Badge>
      ) : null}
      {message.latency_ms ? (
        <Badge variant="outline">{(message.latency_ms / 1000).toFixed(1)}s</Badge>
      ) : null}
      {message.model ? (
        <Badge variant="outline" className="font-normal">
          {message.model.split("/").pop()}
        </Badge>
      ) : null}
    </div>
  );
}

export function MessageItem({ message, userName }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          {message.content}
        </div>
        <Avatar name={userName || "You"} className="bg-primary/15 text-primary" />
      </div>
    );
  }

  const data = message.data_json;
  const isError = message.status === "error";
  const hasChart =
    !isError &&
    message.chart_config &&
    message.chart_config.type !== "table" &&
    data?.rows?.length > 0;
  const showTable = !isError && data?.rows?.length > 0;

  async function copySql() {
    if (!message.sql_query) return;
    try {
      await navigator.clipboard.writeText(message.sql_query);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy SQL");
    }
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 text-white">
        <Bot className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">AI Analyst</span>
          {message.created_at ? (
            <span className="text-xs text-muted-foreground">{timeAgo(message.created_at)}</span>
          ) : null}
        </div>

        <Card className={cn(isError && "border-destructive/40")}>
          <CardContent className="space-y-3 p-4">
            <MessageBadges message={message} />

            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
            {isError && message.error ? (
              <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {message.error}
              </div>
            ) : null}

            {!isError && (hasChart || showTable || message.sql_query) ? (
              <Tabs defaultValue={hasChart ? "chart" : showTable ? "data" : "sql"}>
                <TabsList>
                  {hasChart ? <TabsTrigger value="chart">Chart</TabsTrigger> : null}
                  {showTable ? <TabsTrigger value="data">Data</TabsTrigger> : null}
                  {message.sql_query ? <TabsTrigger value="sql">SQL</TabsTrigger> : null}
                  {message.attempts?.length ? (
                    <TabsTrigger value="trace">Trace</TabsTrigger>
                  ) : null}
                </TabsList>

                {hasChart ? (
                  <TabsContent value="chart">
                    <ChartRenderer config={message.chart_config} rows={data.rows} />
                  </TabsContent>
                ) : null}

                {showTable ? (
                  <TabsContent value="data" className="space-y-2">
                    {data.truncated && message.row_count ? (
                      <p className="text-xs text-muted-foreground">
                        Showing the first {data.rows.length} of{" "}
                        {message.row_count.toLocaleString()}{" "}
                        {message.row_count === 1 ? "row" : "rows"}.
                      </p>
                    ) : null}
                    <DataTable columns={data.columns} rows={data.rows} />
                  </TabsContent>
                ) : null}

                {message.sql_query ? (
                  <TabsContent value="sql">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={copySql}
                        title="Copy SQL"
                        className="absolute right-2 top-2 rounded-md border bg-background p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Copy className={cn("h-3.5 w-3.5", copied && "text-emerald-500")} />
                      </button>
                      <pre className="max-h-72 overflow-auto rounded-md bg-muted/60 p-3 pr-10 font-mono text-xs">
                        {message.sql_query}
                      </pre>
                    </div>
                    {message.explanation ? (
                      <p className="mt-2 text-xs text-muted-foreground">{message.explanation}</p>
                    ) : null}
                  </TabsContent>
                ) : null}

                {message.attempts?.length ? (
                  <TabsContent value="trace">
                    <ul className="space-y-2">
                      {dedupeSteps(message.attempts).map((step, index) => (
                        <PipelineStepRow key={index} step={step} />
                      ))}
                    </ul>
                  </TabsContent>
                ) : null}
              </Tabs>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { PipelineStepRow };

