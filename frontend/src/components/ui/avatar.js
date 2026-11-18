import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
        className
      )}
    >
      {initials(name)}
    </div>
  );
}
