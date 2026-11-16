"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangle, Bell, CheckCircle2, Info, Sparkles, X, XCircle } from "lucide-react";
import { TONE_CLASSES, type Tone } from "@/lib/notifications/tones";

/**
 * default = brand (violet), success = green, info = blue, warning = amber,
 * destructive = red, order = gold (new orders, money).
 */
type ToastType = "default" | "success" | "info" | "warning" | "destructive" | "order";

export type Toast = {
  id: string;
  title?: string;
  description?: string;
  type?: ToastType;
  /** Milliseconds before it closes by itself; 0 keeps it until dismissed. */
  duration?: number;
  action?: React.ReactNode;
};

type ToastContextValue = {
  toasts: Toast[];
  toast: (props: Omit<Toast, "id">) => {
    id: string;
    update: (patch: Partial<Toast>) => void;
  };
  dismiss: (id: string) => void;
};

const TOAST_LIMIT = 5;
const DEFAULT_DURATION = 5000;

const TYPE_TONE: Record<ToastType, Tone> = {
  default: "violet",
  success: "emerald",
  info: "sky",
  warning: "amber",
  destructive: "rose",
  order: "gold",
};

const TYPE_ICON: Record<ToastType, React.ComponentType<{ className?: string }>> = {
  default: Sparkles,
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  destructive: XCircle,
  order: Bell,
};

let count = 0;
function genId() {
  return (++count).toString();
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((old) => old.filter((x) => x.id !== id));
  }, []);

  const schedule = React.useCallback(
    (id: string, duration: number | undefined) => {
      const prev = timers.current.get(id);
      if (prev) clearTimeout(prev);
      timers.current.delete(id);
      const ms = duration ?? DEFAULT_DURATION;
      if (ms > 0) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss]
  );

  const toast = React.useCallback(
    (props: Omit<Toast, "id">) => {
      const id = genId();
      const item: Toast = { id, type: "default", duration: DEFAULT_DURATION, ...props };
      setToasts((old) => [item, ...old].slice(0, TOAST_LIMIT));
      schedule(id, item.duration);

      const update = (patch: Partial<Toast>) => {
        setToasts((old) => old.map((t) => (t.id === id ? { ...t, ...patch } : t)));
        if ("duration" in patch) schedule(id, patch.duration);
      };

      return { id, update };
    },
    [schedule]
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/** Top centre of the screen, newest first. */
export function ToastViewport() {
  const { toasts, dismiss } = React.useContext(ToastContext)!;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] mx-auto flex w-[min(440px,calc(100%-1.5rem))] flex-col gap-2 sm:top-4"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto animate-in fade-in-0 slide-in-from-top-4 duration-300">
          <Toast toast={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function Toast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const type = toast.type ?? "default";
  const tone = TONE_CLASSES[TYPE_TONE[type]];
  const Icon = TYPE_ICON[type];
  return (
    <div
      role={type === "destructive" || type === "warning" ? "alert" : "status"}
      className={cn(
        "relative flex items-start gap-3 overflow-hidden rounded-xl border py-3 pl-4 pr-3 text-white shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] backdrop-blur",
        tone.surface
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} />
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", tone.tile)}>
        <Icon className={cn("size-4", tone.icon)} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 pt-0.5 leading-snug">
        {toast.title && <div className={cn("text-sm font-semibold", tone.title)}>{toast.title}</div>}
        {toast.description && <div className="text-xs text-zinc-300/90">{toast.description}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2 self-center">
        {toast.action && <div>{toast.action}</div>}
        <button onClick={onDismiss} className="rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Dismiss">
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
