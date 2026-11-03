"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type ToastType = "default" | "destructive";

export type Toast = {
  id: string;
  title?: string;
  description?: string;
  type?: ToastType;
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

let count = 0;
function genId() {
  return (++count).toString();
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((old) => old.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((props: Omit<Toast, "id">) => {
    const id = genId();
    const item: Toast = { id, type: "default", duration: 4000, ...props };

    setToasts((old) => [item, ...old].slice(0, TOAST_LIMIT));

    const update = (patch: Partial<Toast>) => {
      setToasts((old) => old.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    };

    return { id, update };
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

export function ToastViewport() {
  const { toasts, dismiss } = React.useContext(ToastContext)!;
  return (
    <div className="pointer-events-auto fixed bottom-0 right-0 z-[100] flex flex-col gap-2 w-full sm:w-[420px] mr-4 mb-4">
      {toasts.map((t) => (
        <div key={t.id} className="relative">
          <Toast toast={t} onDismiss={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}

export function Toast({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-[#111319] p-4 text-white shadow-lg flex gap-3 items-start",
        toast.type === "destructive" && "border-rose-500/30 bg-rose-500/10",
      )}
    >
      <div className="mt-0.5 shrink-0 size-4 text-violet-400">
        {toast.type === "destructive" ? "!" : "✓"}
      </div>
      <div className="flex flex-col gap-1 leading-snug">
        {toast.title && <div className="text-sm font-semibold">{toast.title}</div>}
        {toast.description && <div className="text-xs text-zinc-400">{toast.description}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {toast.action && <div>{toast.action}</div>}
        <button onClick={onDismiss} className="p-1 text-zinc-500 hover:text-white" aria-label="Dismiss">
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
