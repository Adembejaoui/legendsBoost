"use client";

import {
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  Coins,
  CreditCard,
  Gavel,
  Heart,
  LifeBuoy,
  MessageSquare,
  PlayCircle,
  ShieldAlert,
  Star,
  TrendingUp,
  UserCheck,
  UserX,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notificationTone, TONE_CLASSES } from "@/lib/notifications/tones";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  NEW_MESSAGE: MessageSquare,
  ORDER_CREATED: Bell,
  ORDER_OFFERED: Bell,
  ORDER_STARTED: PlayCircle,
  SESSION_STARTED: PlayCircle,
  ORDER_REOPENED: PlayCircle,
  ORDER_PROGRESS_UPDATED: TrendingUp,
  ORDER_COMPLETED: CheckCircle2,
  PAYMENT_SUCCEEDED: CheckCircle2,
  SUPPORT_TICKET_RESOLVED: CheckCircle2,
  ORDER_CANCELLED: XCircle,
  PAYMENT_FAILED: XCircle,
  BOOSTER_ASSIGNED: UserCheck,
  BOOSTER_ACCEPTED: UserCheck,
  BOOSTER_REASSIGNED: UserCheck,
  BOOSTER_REJECTED: UserX,
  BOOSTER_REMOVED: UserX,
  BOOSTER_ABANDONED: UserX,
  SUPPORT_REPLY: LifeBuoy,
  SUPPORT_STATUS_UPDATED: LifeBuoy,
  SUPPORT_TICKET_CREATED: LifeBuoy,
  EARNING_AVAILABLE: Wallet,
  PAYOUT_UPDATED: Wallet,
  PAYOUT_METHOD_CHANGED: Wallet,
  REFUND_ISSUED: CreditCard,
  TIP_RECEIVED: Heart,
  REVIEW_RECEIVED: Star,
  BID_WON: Gavel,
  BID_LOST: Gavel,
  FINE_ISSUED: Coins,
  FINE_APPEAL_DECIDED: Coins,
  STRIKE_ADDED: Ban,
  GAME_ANOMALY: ShieldAlert,
  CHAT_FLAGGED: ShieldAlert,
  FINANCE_ALERT: ShieldAlert,
  COMPLETION_SUBMITTED: CheckCircle2,
  COMPLETION_DISPUTED: AlertTriangle,
  COMPLETION_SENT_BACK: AlertTriangle,
  PROGRESS_UPDATE_DUE: TrendingUp,
};

/** Coloured icon tile for a notification type (same colours as the toasts). */
export function NotificationIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" }) {
  const tone = TONE_CLASSES[notificationTone(type)];
  const Icon = ICONS[type] ?? AlertTriangle;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-lg", tone.tile, size === "sm" ? "size-8" : "size-10")}>
      <Icon className={cn(tone.icon, size === "sm" ? "size-4" : "size-5")} />
    </span>
  );
}
