"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bot, Loader2, Plus, Send, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/auth-provider";
import { MessageItem, PipelineStepRow } from "@/components/chat/message-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, streamAsk } from "@/lib/api";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Total revenue by month",
  "Top 10 customers by order value",
  "Orders per order status",
  "Monthly revenue trend by region",
];

function resultToMessage(result) {
  return {
    id: result.assistant_message_id ?? -Date.now(),
    role: "assistant",
    content: result.answer || result.error || "",
    sql_query: result.sql,
    explanation: result.explanation,
    status: result.status,
    error: result.error,
    chart_config: result.chart,
    data_json: result.rows
      ? { columns: result.columns || [], rows: result.rows, truncated: result.truncated }
      : null,
    row_count: result.row_count,
    latency_ms: result.latency_ms,
    attempts: result.steps,
    model: null,
    created_at: new Date().toISOString(),
  };
}

function ChatView() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const openId = searchParams.get("c");
  const [datasources, setDatasources] = useState([]);
  const [datasourceId, setDatasourceId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveSteps, setLiveSteps] = useState([]);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const composerRef = useRef(null);
  const lastOpenedRef = useRef(null);
  const pendingOpenRef = useRef(null);

  const refreshConversations = useCallback(async (id) => {
    if (!id) return;
    try {
      setConversations(await api.listConversations(id));
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listDatasources();
        if (cancelled) return;
        setDatasources(list);
        if (list.length > 0) setDatasourceId((current) => current ?? list[0].id);
      } catch {
        /* non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveId(null);
    setMessages([]);
    setLiveSteps([]);
    setConversations([]);
    refreshConversations(datasourceId);
  }, [datasourceId, refreshConversations]);

  // Deep link support: /chat?c=<id> (opened via a full page navigation from
  // the dashboard) opens that conversation. It may belong to a different data
  // source than the one currently selected, so when it is not in the filtered
  // list we look it up across all sources and switch the selector (the
  // conversations effect opens it once that list has loaded).
  useEffect(() => {
    if (!openId || lastOpenedRef.current === openId) return;
    const target = conversations.find((item) => String(item.id) === openId);
    if (target) {
      lastOpenedRef.current = String(target.id);
      openConversation(target);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const all = await api.listConversations();
        if (cancelled) return;
        const match = all.find((item) => String(item.id) === openId);
        if (!match) return;
        if (match.datasource_id && match.datasource_id !== datasourceId) {
          pendingOpenRef.current = match.id;
          setDatasourceId(match.datasource_id);
          return;
        }
        lastOpenedRef.current = String(match.id);
        openConversation(match);
      } catch {
        /* ignore deep-link failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openId, conversations, datasourceId]);

  // Opens a deep-linked conversation after its data source finishes loading.
  useEffect(() => {
    if (!pendingOpenRef.current || conversations.length === 0) return;
    const target = conversations.find(
      (item) => String(item.id) === String(pendingOpenRef.current)
    );
    if (target) {
      pendingOpenRef.current = null;
      lastOpenedRef.current = String(target.id);
      openConversation(target);
    }
  }, [conversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, liveSteps, streaming]);

  async function openConversation(conversation) {
    setActiveId(conversation.id);
    setLiveSteps([]);
    try {
      setMessages(await api.getMessages(conversation.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load messages");
    }
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setLiveSteps([]);
  }

  async function removeConversation(id) {
    try {
      await api.deleteConversation(id);
      if (activeId === id) newChat();
      refreshConversations(datasourceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete conversation");
    }
  }

  async function send() {
    const question = input.trim();
    if (!question || streaming) return;
    if (!datasourceId) {
      toast.error("Add and select a data source first");
      return;
    }
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    setStreaming(true);
    setLiveSteps([]);
    const controller = new AbortController();
    abortRef.current = controller;
    const optimistic = {
      id: -Date.now(),
      role: "user",
      content: question,
      sql_query: null,
      explanation: null,
      status: null,
      error: null,
      chart_config: null,
      data_json: null,
      row_count: null,
      latency_ms: null,
      attempts: null,
      model: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      await streamAsk(
        { datasource_id: datasourceId, question, conversation_id: activeId },
        (event) => {
          if (event.event === "step") {
            // Replace the "started" entry of the same (step, attempt) in place
            // so the live trace shows one row per step instead of duplicates.
            setLiveSteps((prev) => {
              const index = prev.findIndex(
                (item) =>
                  item.step === event.data.step &&
                  (item.attempt || 1) === (event.data.attempt || 1)
              );
              if (index === -1) return [...prev, event.data];
              const next = [...prev];
              next[index] = event.data;
              return next;
            });
          } else if (event.event === "final") {
            const result = event.data;
            setActiveId(result.conversation_id);
            setMessages((prev) => [...prev, resultToMessage(result)]);
            if (result.status === "error") toast.error(result.error || "Analysis failed");
            refreshConversations(datasourceId);
          } else if (event.event === "error") {
            toast.error(event.data?.message || "Pipeline error");
          }
        },
        controller.signal
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        toast.info("Analysis stopped");
      } else {
        toast.error(error instanceof Error ? error.message : "Request failed");
        setMessages((prev) => prev.filter((item) => item.id !== optimistic.id));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  }

  const activeDatasource = datasources.find((item) => item.id === datasourceId);

  return (
    <div className="flex h-full min-h-0 w-full">
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-card/50 lg:flex">
        <div className="flex items-center justify-between px-4 py-4">
          <p className="text-sm font-semibold">Conversations</p>
          <Button size="sm" variant="outline" onClick={newChat}>
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                activeId === conversation.id ? "bg-accent" : "hover:bg-accent/60"
              )}
            >
              <button
                type="button"
                title={conversation.title}
                className="line-clamp-2 min-w-0 flex-1 break-words text-left"
                onClick={() => openConversation(conversation)}
              >
                {conversation.title}
              </button>
              <button
                type="button"
                title="Delete"
                className="opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => removeConversation(conversation.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
          ) : null}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          {datasourceId ? (
            <Select
              key="datasource-selected"
              value={String(datasourceId)}
              onValueChange={(value) => setDatasourceId(Number(value))}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select data source" />
              </SelectTrigger>
              <SelectContent>
                {datasources.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name} · {item.db_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              key="datasource-none"
              onValueChange={(value) => setDatasourceId(Number(value))}
            >
              <SelectTrigger className="w-[240px]">
                <SelectValue placeholder="Select data source" />
              </SelectTrigger>
              <SelectContent>
                {datasources.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.name} · {item.db_type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activeDatasource ? (
            <Badge variant="outline" className="font-normal">
              {activeDatasource.host}/{activeDatasource.database}
            </Badge>
          ) : null}
          {datasources.length === 0 ? (
            <Link
              href="/datasources"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Add a data source →
            </Link>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              Qwen2.5-0.5B · local
            </Badge>
            <Button size="sm" variant="outline" onClick={newChat}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
          {messages.length === 0 && !streaming ? (
            <div className="mx-auto max-w-xl pt-10 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Bot className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold">Ask your data anything</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The analyst writes SQL, validates it with SQLGlot, executes it read-only and
                visualizes the result.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              userName={user?.full_name || user?.email}
            />
          ))}

          {streaming ? (
            <Card className="w-full max-w-[92%]">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Analyzing…
                </div>
                <ul className="space-y-2">
                  {liveSteps.map((step, index) => (
                    <PipelineStepRow key={index} step={step} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="border-t p-3 md:p-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <Textarea
              ref={composerRef}
              value={input}
              rows={1}
              onChange={(event) => {
                setInput(event.target.value);
                const element = event.target;
                element.style.height = "auto";
                element.style.height = `${Math.min(160, element.scrollHeight)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={
                activeDatasource
                  ? `Ask a question about ${activeDatasource.database}…`
                  : "Select a data source first"
              }
              disabled={streaming || !datasourceId}
              className="max-h-40 min-h-[44px] flex-1 resize-none"
            />
            {streaming ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Stop"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                title="Send (Enter)"
                disabled={!input.trim() || !datasourceId}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatFallback />}>
      <ChatView />
    </Suspense>
  );
}
