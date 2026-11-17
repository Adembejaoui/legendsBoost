/**
 * Colours shared by toasts, the notification bell and the notifications page
 * (browser-safe). Palette follows the site: violet = brand, gold = orders and
 * money, emerald = success, sky = progress, amber = warning, rose = problem.
 */
export type Tone = "violet" | "gold" | "emerald" | "sky" | "amber" | "rose";

export const TONE_CLASSES: Record<
  Tone,
  {
    /** Toast / card surface. */
    surface: string;
    /** Left stripe and unread dot. */
    bar: string;
    /** Icon colour. */
    icon: string;
    /** Icon tile background. */
    tile: string;
    /** Title colour. */
    title: string;
  }
> = {
  violet: {
    surface: "border-violet-400/40 bg-gradient-to-r from-violet-600/30 via-[#17122a] to-[#111319]",
    bar: "bg-violet-400",
    icon: "text-violet-300",
    tile: "bg-violet-500/15 ring-1 ring-inset ring-violet-400/30",
    title: "text-violet-100",
  },
  gold: {
    surface: "border-[#C8AA6E]/50 bg-gradient-to-r from-[#C8AA6E]/30 via-[#1d1910] to-[#111319]",
    bar: "bg-[#C8AA6E]",
    icon: "text-[#e3c98f]",
    tile: "bg-[#C8AA6E]/15 ring-1 ring-inset ring-[#C8AA6E]/35",
    title: "text-[#f3e3bd]",
  },
  emerald: {
    surface: "border-emerald-400/40 bg-gradient-to-r from-emerald-600/30 via-[#0f1d18] to-[#111319]",
    bar: "bg-emerald-400",
    icon: "text-emerald-300",
    tile: "bg-emerald-500/15 ring-1 ring-inset ring-emerald-400/30",
    title: "text-emerald-100",
  },
  sky: {
    surface: "border-sky-400/40 bg-gradient-to-r from-sky-600/30 via-[#0f1820] to-[#111319]",
    bar: "bg-sky-400",
    icon: "text-sky-300",
    tile: "bg-sky-500/15 ring-1 ring-inset ring-sky-400/30",
    title: "text-sky-100",
  },
  amber: {
    surface: "border-amber-400/45 bg-gradient-to-r from-amber-500/30 via-[#211a0e] to-[#111319]",
    bar: "bg-amber-400",
    icon: "text-amber-300",
    tile: "bg-amber-500/15 ring-1 ring-inset ring-amber-400/30",
    title: "text-amber-100",
  },
  rose: {
    surface: "border-rose-400/45 bg-gradient-to-r from-rose-600/30 via-[#221016] to-[#111319]",
    bar: "bg-rose-400",
    icon: "text-rose-300",
    tile: "bg-rose-500/15 ring-1 ring-inset ring-rose-400/30",
    title: "text-rose-100",
  },
};

/** Tone of a stored notification, by its type. */
export function notificationTone(type: string): Tone {
  switch (type) {
    case "ORDER_COMPLETED":
    case "COMPLETION_SUBMITTED":
    case "BOOSTER_ASSIGNED":
    case "BOOSTER_ACCEPTED":
    case "PAYMENT_SUCCEEDED":
    case "SUPPORT_TICKET_RESOLVED":
    case "BID_WON":
    case "REVIEW_RECEIVED":
      return "emerald";
    case "ORDER_CREATED":
    case "ORDER_OFFERED":
    case "EARNING_AVAILABLE":
    case "PAYOUT_UPDATED":
    case "TIP_RECEIVED":
    case "REFUND_ISSUED":
      return "gold";
    case "ORDER_STARTED":
    case "ORDER_PROGRESS_UPDATED":
    case "ORDER_REOPENED":
    case "SESSION_STARTED":
    case "BOOSTER_REASSIGNED":
      return "sky";
    case "SUPPORT_REPLY":
    case "SUPPORT_STATUS_UPDATED":
    case "SUPPORT_TICKET_CREATED":
    case "SLA_WARNING":
    case "INACTIVITY_WARNING":
    case "STRIKE_ADDED":
    case "FINE_APPEAL_DECIDED":
    case "COMPLETION_REVIEW":
    case "COMPLETION_DISPUTED":
    case "COMPLETION_SENT_BACK":
    case "PROGRESS_UPDATE_DUE":
    case "ACCOUNT_DELETION_REQUESTED":
    case "PAYOUT_METHOD_CHANGED":
    case "GAME_ANOMALY":
    case "CHAT_FLAGGED":
    case "FINANCE_ALERT":
      return "amber";
    case "ORDER_CANCELLED":
    case "BOOSTER_REJECTED":
    case "BOOSTER_REMOVED":
    case "BOOSTER_ABANDONED":
    case "PAYMENT_FAILED":
    case "BID_LOST":
    case "FINE_ISSUED":
      return "rose";
    default:
      return "violet"; // NEW_MESSAGE and anything new
  }
}
