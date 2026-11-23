"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { AlertTriangle, ArrowLeft, ClipboardList, KeyRound, LayoutGrid, MessageSquare, PauseCircle, TrendingUp } from "lucide-react";
import type { WorkspaceDTO } from "@/lib/orders/workspace-types";
import type { RawServerMessage } from "@/lib/chat/message-sync";
import type { OrderLifecycleEvent } from "@/lib/chat/realtime-sync";
import { OrderChat } from "@/components/chat/OrderChat";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { OrderInfoPanel } from "./OrderInfoPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { GameAccountPanel } from "./GameAccountPanel";
import { CancellationBanner } from "./CancellationBanner";
import { CompletionPanel } from "./CompletionPanel";
import { ChampionRolesPanel } from "./ChampionRolesPanel";
import { RankProgressPanel } from "./RankProgressPanel";
import { ProgressUpdatesPanel } from "./ProgressUpdatesPanel";
import { OrderControls } from "./OrderControls";
import { Pill, ORDER_STATUS_TONE } from "./Panel";
import { gameThemeStyle } from "./game-theme";

const STATUS_POLL_MS = 15_000;

/**
 * Keeps the workspace in sync with lifecycle changes made elsewhere (the
 * other participant pauses / resumes / completes, an admin republishes, a
 * sync lands). Realtime order events trigger an immediate refresh; this
 * authorized status probe is the fallback while the tab is visible.
 */
function useLiveOrderRefresh(orderId: string) {
  const router = useRouter();
  const version = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    async function probe() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/orders/${orderId}/status`, { cache: "no-store" });
        if (res.status === 404 || res.status === 401) {
          // Access was revoked (e.g. reassignment): re-render server-side,
          // which shows the not-found page.
          router.refresh();
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { version: string };
        if (version.current && version.current !== body.version && !stopped) router.refresh();
        version.current = body.version;
      } catch {
        /* offline: try again next tick */
      }
    }
    void probe();
    const t = setInterval(probe, STATUS_POLL_MS);
    const onVis = () => void probe();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [orderId, router]);
}

const BACK_HREF = {
  customer: "/dashboard/customer",
  booster: "/dashboard/booster/claimed-orders",
  admin: "/dashboard/admin/orders",
};

function PausedBanner({ data }: { data: WorkspaceDTO }) {
  if (data.order.status !== "PAUSED") return null;
  const since = data.pause?.since ? new Date(data.pause.since) : null;
  const byCustomer = data.pause?.byCustomer ?? false;
  const role = data.viewer.role;

  let headline: string;
  let body: string;
  if (role === "booster") {
    headline = byCustomer ? "Order paused by the customer. Stop boosting immediately." : "This order is paused. Stop boosting.";
    body = "Do not continue playing on the customer's account until the order is resumed. Completing and abandoning are disabled while paused.";
  } else if (role === "customer") {
    headline = "You paused this order.";
    body = "Your booster has been told to stop playing on your account. Resume whenever you're ready; your progress is kept.";
  } else {
    headline = byCustomer ? "Paused by the customer." : "This order is paused.";
    body = "The booster cannot complete or abandon it until the customer resumes it.";
  }

  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.09] px-3 py-2 sm:items-center"
    >
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-400 px-2 py-0.5 text-[11px] font-black tracking-[0.12em] text-[#0A0E14] sm:mt-0">
        <PauseCircle className="size-3.5" /> PAUSED
      </span>
      <p className="min-w-0 text-[13px] leading-snug text-amber-100">
        <span className="font-semibold">{headline}</span> <span className="text-amber-100/80">{body}</span>
        {since && (
          <span className="ml-1 whitespace-nowrap text-[11px] text-amber-200/60">
            Since {since.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        )}
      </p>
    </div>
  );
}

function AbandonmentNotice({ data }: { data: WorkspaceDTO }) {
  const a = data.abandonment;
  if (!a) return null;
  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.06] p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium text-violet-200">
        <AlertTriangle className="size-4" /> Abandoned{a.boosterName ? ` by ${a.boosterName}` : ""}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-400">{new Date(a.at).toLocaleString()}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-zinc-200">{a.reason ?? "No reason given."}</p>
      {data.access.canManageDraft && (
        <Link
          href={`/dashboard/admin/orders/${data.order.id}`}
          className="mt-2 inline-flex rounded-lg bg-[var(--g-accent)] px-3 py-1.5 text-sm font-semibold text-[#0A0E14] hover:bg-[var(--g-hover)]"
        >
          Review &amp; republish
        </Link>
      )}
    </div>
  );
}

type DetailsTab = "order" | "account";

/** Order details and account, as one card with two tabs (no long scrolling column). */
function DetailsCard({ data, className }: { data: WorkspaceDTO; className?: string }) {
  // Boosters mostly need the account (login, Riot ID); customers the order.
  const [tab, setTab] = useState<DetailsTab>(data.viewer.role === "booster" ? "account" : "order");
  // Client PDF 2026-11-21: the first time a customer opens a paid order, show
  // the Account tab (where they add their login). Remembered per browser.
  useEffect(() => {
    if (data.viewer.role !== "customer") return;
    const key = `lb.orderSeen.${data.order.id}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    // After mount (the server render always starts on Order).
    const t = setTimeout(() => setTab("account"), 0);
    return () => clearTimeout(t);
  }, [data.viewer.role, data.order.id]);
  const hasPrefs = data.preferences.roles.length > 0 || data.preferences.champions.length > 0;
  const tabs: { id: DetailsTab; label: string; icon: React.ReactNode }[] = [
    { id: "order", label: "Order", icon: <ClipboardList className="size-3.5" /> },
    { id: "account", label: "Account", icon: <KeyRound className="size-3.5" /> },
  ];
  return (
    <section
      aria-label="Order details and account"
      className={cn("min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0f15]", className)}
    >
      <div role="tablist" aria-label="Details" className="m-2 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-black/30 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-colors",
              tab === t.id
                ? "bg-[var(--g-accent)]/15 text-[var(--g-light)] shadow-[inset_0_0_0_1px_rgba(var(--g-rgb),0.25)]"
                : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      {/* Panels keep their own look; this area only scrolls if a very short
          screen cannot fit them. */}
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-2 pb-2 [scrollbar-width:thin]">
        {tab === "order" ? (
          <>
            <AbandonmentNotice data={data} />
            <OrderInfoPanel data={data} />
            <FeedbackPanel data={data} />
          </>
        ) : (
          <>
            <GameAccountPanel data={data} />
            {hasPrefs && <ChampionRolesPanel data={data} />}
          </>
        )}
      </div>
    </section>
  );
}

type View = "progress" | "details" | "chat";

export default function OrderWorkspace({
  data,
  initialMessages,
}: {
  data: WorkspaceDTO;
  initialMessages: RawServerMessage[];
}) {
  const [view, setView] = useState<View>("progress");
  // "Open order chat" links (poke email) land on the chat on phones.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "chat") return;
    const t = setTimeout(() => setView("chat"), 0);
    return () => clearTimeout(t);
  }, []);
  const router = useRouter();
  const { toast } = useToast();
  useLiveOrderRefresh(data.order.id);
  const showChat = Boolean(data.access.canChat && data.conversationId);
  const role = data.viewer.role;

  // Realtime lifecycle events from the order channel: refresh now instead of
  // waiting for the next status probe. The booster also gets an explicit
  // stop instruction the moment the customer pauses.
  const onOrderEvent = useCallback(
    (_event: OrderLifecycleEvent, payload: { newStatus?: string }) => {
      if (role === "booster" && payload.newStatus === "PAUSED") {
        toast({
          title: "Order paused by the customer",
          description: "Stop boosting immediately. Do not continue playing until the order is resumed.",
          type: "destructive",
          duration: 10_000,
        });
      } else if (role === "booster" && payload.newStatus === "IN_PROGRESS") {
        toast({ type: "success", title: "Order resumed", description: "The customer has resumed the order. You may continue boosting." });
      }
      router.refresh();
    },
    [role, router, toast]
  );

  const participant =
    role === "customer"
      ? { name: data.people.boosterName, roleLabel: data.people.boosterName ? "Your booster" : "A booster will join once the order is claimed" }
      : role === "booster"
        ? { name: data.people.customerName, roleLabel: "Customer" }
        : { name: `${data.people.customerName ?? "Customer"} · ${data.people.boosterName ?? "no booster"}`, roleLabel: "Customer and booster" };

  const views: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "progress", label: "Progress", icon: <TrendingUp className="size-4" /> },
    { id: "details", label: "Details", icon: <LayoutGrid className="size-4" /> },
    ...(showChat ? [{ id: "chat" as View, label: "Chat", icon: <MessageSquare className="size-4" /> }] : []),
  ];
  const activeView: View = view === "chat" && !showChat ? "progress" : view;
  const otherName = role === "customer" ? data.people.boosterName : role === "booster" ? data.people.customerName : null;

  // Visibility per breakpoint (everything stays mounted, so the chat keeps
  // its realtime subscription):
  //  < lg : one view at a time, picked in the bottom tab bar;
  //  lg   : progress or details on the left, chat always on the right;
  //  xl   : details | progress | chat side by side.
  const detailsCls = cn(activeView === "details" ? "flex" : "hidden", "xl:flex");
  const progressCls = cn(activeView === "progress" ? "flex" : activeView === "chat" ? "hidden lg:flex" : "hidden", "xl:flex");
  const chatCls = cn(activeView === "chat" ? "flex" : "hidden", "lg:flex");

  return (
    <div
      data-testid="order-workspace"
      data-game={data.order.gameSlug}
      style={gameThemeStyle(data.order.gameSlug)}
      className="-mt-2 flex h-[calc(100dvh-6.5rem-1px)] min-h-0 flex-col gap-2.5 overflow-hidden text-white sm:mt-0 sm:h-[calc(100dvh-7rem-1px)] sm:gap-3"
    >
      {/* Height = viewport - shell header - main padding. Nothing scrolls the
          page; only the match list, chat and (if needed) the details card do. */}

      {/* Header: game-themed banner with identity, status and the order actions. */}
      <header className="relative shrink-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0f15]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(var(--g-rgb),0.16),transparent_45%),radial-gradient(ellipse_at_100%_0%,rgba(var(--g-rgb2),0.12),transparent_60%)]"
        />
        {data.order.gameImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.order.gameImage}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-2/3 object-cover opacity-[0.16] [mask-image:linear-gradient(to_left,black_20%,transparent)]"
          />
        )}
        <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--g-accent)]" />
        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pl-4 pr-3 sm:py-3">
          <Link
            href={BACK_HREF[role]}
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/20 text-zinc-400 hover:bg-white/5 hover:text-white"
            aria-label="Back to orders"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-[12rem] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--g-light)]">
              {data.order.gameName}
              {data.order.platformLabel ? ` · ${data.order.platformLabel}` : ""}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-lg font-extrabold tracking-tight sm:text-xl">
                {data.order.serviceName} <span className="font-semibold text-zinc-500">#{data.order.shortId}</span>
              </h1>
              <Pill tone={ORDER_STATUS_TONE[data.order.status] ?? "neutral"} className="shrink-0">
                {data.order.statusLabel}
              </Pill>
            </div>
            <p className="truncate text-xs text-zinc-400">
              {otherName ? (
                <>
                  <span className="text-zinc-500">{role === "customer" ? "Booster" : "Customer"}:</span> <span className="text-zinc-200">{otherName}</span>
                  {" · "}
                </>
              ) : null}
              {data.order.statusDescription}
              {data.access.readOnly && role === "booster" ? " · You completed this order (read-only)." : ""}
            </p>
          </div>
          <OrderControls data={data} />
        </div>
      </header>

      <PausedBanner data={data} />
      <CancellationBanner data={data} />
      <CompletionPanel data={data} />

      {/* lg only: switch the left area between progress and details (chat is always visible). */}
      <div role="tablist" aria-label="Workspace sections" className="hidden shrink-0 gap-1 lg:flex xl:hidden">
        {views
          .filter((v) => v.id !== "chat")
          .map((v) => {
            const on = v.id === activeView || (v.id === "progress" && activeView === "chat");
            return (
              <button
                key={v.id}
                role="tab"
                type="button"
                aria-selected={on}
                onClick={() => setView(v.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                  on ? "border-[var(--g-accent)]/30 bg-[var(--g-accent)]/10 text-[var(--g-light)]" : "border-white/[0.07] text-zinc-400 hover:text-zinc-200"
                )}
              >
                {v.icon}
                {v.label}
              </button>
            );
          })}
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3",
          showChat
            ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] lg:[grid-template-areas:'main_chat'] xl:grid-cols-[minmax(270px,310px)_minmax(0,1fr)_minmax(320px,380px)] xl:[grid-template-areas:'left_main_chat']"
            : "xl:grid-cols-[minmax(270px,320px)_minmax(0,1fr)] xl:[grid-template-areas:'left_main']",
          "grid-rows-[minmax(0,1fr)] [grid-template-areas:'main']"
        )}
      >
        <DetailsCard data={data} className={cn("[grid-area:main] xl:[grid-area:left]", detailsCls)} />

        <div
          id="ws-progress"
          role="region"
          aria-label="Progress"
          className={cn("min-h-0 flex-col gap-3 [grid-area:main]", progressCls)}
        >
          <RankProgressPanel data={data} />
          <ProgressUpdatesPanel data={data} className="min-h-[9rem] flex-1" />
        </div>

        {showChat && (
          <aside id="ws-chat" aria-label="Order chat" className={cn("min-h-0 flex-col [grid-area:main] lg:[grid-area:chat]", chatCls)}>
            <OrderChat
              fill
              orderId={data.order.id}
              conversationId={data.conversationId!}
              currentUserId={data.viewer.id}
              currentUserName={data.viewer.name}
              currentUserImage={data.viewer.image}
              initialMessages={initialMessages}
              isCustomer={role === "customer"}
              isBooster={role === "booster"}
              participant={participant}
              onOrderEvent={onOrderEvent}
            />
          </aside>
        )}
      </div>

      {/* Phones and tablets: bottom tab bar. */}
      <nav
        role="tablist"
        aria-label="Workspace sections"
        className="grid shrink-0 grid-flow-col gap-1 rounded-2xl border border-white/[0.08] bg-[#0d0f15] p-1 lg:hidden"
      >
        {views.map((v) => (
          <button
            key={v.id}
            role="tab"
            type="button"
            aria-selected={activeView === v.id}
            aria-controls={`ws-${v.id}`}
            onClick={() => setView(v.id)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-colors",
              activeView === v.id ? "bg-[var(--g-accent)]/15 text-[var(--g-light)]" : "text-zinc-500 hover:text-zinc-200"
            )}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
