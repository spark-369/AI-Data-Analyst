"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Monitor, Moon, Sun } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setThemeState] = useState("system");
  const containerRef = useRef(null);

  useEffect(() => {
    setThemeState(window.localStorage.getItem("aida_theme") || "system");
  }, []);

  useEffect(() => {
    function onDocumentClick(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  function setTheme(next) {
    setThemeState(next);
    window.localStorage.setItem("aida_theme", next);
    const dark =
      next === "dark" ||
      (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  if (!user) return null;
  const displayName = user.full_name || user.email;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2.5 rounded-lg border bg-background p-2 text-left transition-colors hover:bg-accent"
      >
        <Avatar name={displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-full min-w-[230px] rounded-xl border bg-popover p-2 shadow-lg">
          <div className="px-2 py-1.5">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <p className="px-2 pb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
          <div className="grid grid-cols-3 gap-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-xs transition-colors",
                  theme === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
