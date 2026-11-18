import { Bot } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrandMark({ className }) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white shadow-sm",
        className
      )}
    >
      <Bot className="h-5 w-5" />
    </div>
  );
}

export function Brand({ subtitle = "NL → SQL BI Dashboard" }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">AI Data Analyst</p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
