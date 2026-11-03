"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type OrderAction = "pause" | "resume" | "complete";

const ACTIONS: Record<
  OrderAction,
  { label: string; busy: string; done: string; message: string }
> = {
  pause: {
    label: "Pause order",
    busy: "Pausing…",
    done: "Order paused",
    message: "You can resume it whenever you're ready.",
  },
  resume: {
    label: "Resume order",
    busy: "Resuming…",
    done: "Order resumed",
    message: "The order is back in progress.",
  },
  complete: {
    label: "Complete order",
    busy: "Completing…",
    done: "Order completed",
    message: "The order has been marked as complete.",
  },
};

const primary =
  "bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85] focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40 disabled:opacity-70";
const secondary =
  "border-white/10 bg-transparent text-zinc-200 hover:bg-white/[0.06] hover:text-white";

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function OrderActions({
  orderId,
  status,
  assignmentId,
  assignmentStatus,
}: {
  orderId: string;
  status: string;
  assignmentId: string;
  assignmentStatus: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState<OrderAction | null>(null);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const isPaused = status === "PAUSED" || assignmentStatus === "PAUSED";
  const isInProgress = status === "IN_PROGRESS" || assignmentStatus === "IN_PROGRESS";
  const busy = loading !== null;

  // Land on the safe choice when the confirmation opens; Escape closes it.
  useEffect(() => {
    if (!confirmingComplete) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmingComplete(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmingComplete]);

  async function executeAction(action: OrderAction) {
    setLoading(action);
    try {
      const res = await fetch(`/api/booster/orders/${orderId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });

      if (res.ok) {
        toast({ title: ACTIONS[action].done, description: ACTIONS[action].message });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Action failed",
          description: data.error || `Couldn't ${ACTIONS[action].label.toLowerCase()}. Try again.`,
          type: "destructive",
        });
      }
    } catch {
      toast({
        title: "Action failed",
        description: "Something went wrong. Check your connection and try again.",
        type: "destructive",
      });
    } finally {
      setLoading(null);
      setConfirmingComplete(false);
    }
  }

  if (!isInProgress && !isPaused) return null;

  if (confirmingComplete) {
    return (
      <div
        role="group"
        aria-label="Confirm completing this order"
        className="mt-6 rounded-lg border border-[#C8AA6E]/30 bg-[#C8AA6E]/5 p-4"
      >
        <p className="text-sm font-medium text-white">Mark this order as complete?</p>
        <p className="mt-1 text-sm text-zinc-400">
          Only do this once the boost is finished.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            className={cn("gap-2", primary)}
            onClick={() => executeAction("complete")}
            disabled={busy}
          >
            {loading === "complete" ? (
              <>
                <Spinner />
                {ACTIONS.complete.busy}
              </>
            ) : (
              ACTIONS.complete.label
            )}
          </Button>
          <Button
            ref={cancelRef}
            size="sm"
            variant="outline"
            className={secondary}
            onClick={() => setConfirmingComplete(false)}
            disabled={busy}
          >
            Keep working
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Order actions" className="mt-6 flex flex-wrap gap-3">
      {isInProgress && (
        <>
          <Button
            size="sm"
            variant="outline"
            className={cn("gap-2", secondary)}
            onClick={() => executeAction("pause")}
            disabled={busy}
          >
            {loading === "pause" ? (
              <>
                <Spinner />
                {ACTIONS.pause.busy}
              </>
            ) : (
              ACTIONS.pause.label
            )}
          </Button>
          <Button
            size="sm"
            className={primary}
            onClick={() => setConfirmingComplete(true)}
            disabled={busy}
          >
            {ACTIONS.complete.label}
          </Button>
        </>
      )}
      {isPaused && (
        <Button
          size="sm"
          className={cn("gap-2", primary)}
          onClick={() => executeAction("resume")}
          disabled={busy}
        >
          {loading === "resume" ? (
            <>
              <Spinner />
              {ACTIONS.resume.busy}
            </>
          ) : (
            ACTIONS.resume.label
          )}
        </Button>
      )}
    </div>
  );
}