"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Database,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Brand, BrandMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getToken } from "@/lib/api";

const FEATURES = [
  {
    icon: Sparkles,
    title: "Natural language → SQL",
    text: "A local Qwen2.5 model writes the query for you — no SQL knowledge required.",
  },
  {
    icon: ShieldCheck,
    title: "Guardrailed by SQLGlot",
    text: "Every statement is parsed, table-whitelisted and forced read-only before execution.",
  },
  {
    icon: Database,
    title: "Works with your stack",
    text: "PostgreSQL, MySQL and SQL Server — connect in seconds, schemas auto-discovered.",
  },
  {
    icon: BarChart3,
    title: "Instant visualizations",
    text: "Results become the right chart automatically — bar, line, pie, scatter — plus the raw table.",
  },
  {
    icon: RefreshCw,
    title: "Self-correcting agent",
    text: "If a query fails, the analyst fixes itself and retries — you watch every step live.",
  },
  {
    icon: ScrollText,
    title: "Full audit trail",
    text: "Every prompt, generated query and answer is logged for review.",
  },
];

const STEPS = [
  {
    title: "Connect a database",
    text: "Register a read-only PostgreSQL, MySQL or SQL Server source.",
  },
  {
    title: "Ask a question",
    text: "Type it in plain English — e.g. “Total revenue by month”.",
  },
  {
    title: "The analyst goes to work",
    text: "Schema context → SQL → guardrails → execution → insight.",
  },
  {
    title: "Read the answer",
    text: "Chart, table, SQL and reasoning — all in one card.",
  },
];

const BARS = [45, 70, 55, 90, 65, 100];

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(getToken()));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Brand subtitle="Self-hosted analytics" />
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Button asChild>
                <Link href="/dashboard">
                  Open dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
                <Button asChild>
                  <Link href="/register">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden border-b">
          <div className="pointer-events-none absolute inset-0 bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)]" />
          <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-20 text-center md:py-28">
            <Badge variant="secondary" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              100% local — your data never leaves your machine
            </Badge>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">
              Ask your data anything.
              <span className="block bg-gradient-to-r from-indigo-500 to-cyan-400 bg-clip-text text-transparent">
                Get charts, not SQL.
              </span>
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              An autonomous analyst that writes guardrailed SQL with a local LLM, runs it
              read-only against your own databases, and explains the result.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" asChild>
                <Link href={signedIn ? "/dashboard" : "/register"}>
                  {signedIn ? "Open dashboard" : "Get started"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/login">Sign in</Link>
              </Button>
            </div>

            <Card className="mt-8 w-full max-w-xl text-left shadow-lg">
              <CardContent className="space-y-3 p-4">
                <div className="flex justify-end">
                  <div className="rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    Total revenue by month
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <BrandMark className="h-7 w-7" />
                  <div className="flex-1 rounded-xl border bg-card p-3 text-sm">
                    <p className="font-medium">
                      Revenue grew from 98,000 to 141,000 over the quarter.
                    </p>
                    <div className="mt-3 flex h-24 items-end gap-2">
                      {BARS.map((height, index) => (
                        <div
                          key={index}
                          className="w-full rounded-t bg-primary/70"
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Everything an analyst needs
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-muted-foreground">
            Built for teams that cannot send data to third-party APIs.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <Card key={title}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="border-t bg-muted/30">
          <div className="mx-auto w-full max-w-6xl px-6 py-16">
            <h2 className="text-center text-3xl font-semibold tracking-tight">How it works</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-4">
              {STEPS.map((step, index) => (
                <div key={step.title} className="rounded-xl border bg-background p-4">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </div>
                  <p className="mt-3 font-medium">{step.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 text-sm text-muted-foreground sm:flex-row">
          <p>AI Data Analyst — self-hosted, local-first analytics.</p>
          <p>FastAPI · Ollama · SQLGlot · Next.js</p>
        </div>
      </footer>

    </div>
  );
}
