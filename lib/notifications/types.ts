export type NotificationEventType =
  | "ORDER_CREATED"
  | "ORDER_CANCELLED"
  | "ORDER_STARTED"
  | "ORDER_PROGRESS_UPDATED"
  | "ORDER_PAUSED_BY_CUSTOMER"
  | "ORDER_RESUMED_BY_CUSTOMER"
  | "ORDER_COMPLETED"
  | "ORDER_REOPENED"
  | "BOOSTER_ASSIGNED"
  | "BOOSTER_ACCEPTED"
  | "BOOSTER_REJECTED"
  | "BOOSTER_REASSIGNED"
  | "BOOSTER_REMOVED"
  | "BOOSTER_ABANDONED"
  | "BOOSTER_CHANGE_REQUESTED"
  | "NEW_MESSAGE"
  | "SUPPORT_REPLY"
  | "SUPPORT_STATUS_UPDATED"
  | "SUPPORT_TICKET_CREATED"
  | "SUPPORT_TICKET_RESOLVED"
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "REFUND_ISSUED"
  | "EARNING_AVAILABLE"
  | "PAYOUT_UPDATED"
  | "FINANCE_ALERT"
  | "ORDER_OFFERED"
  | "BID_WON"
  | "BID_LOST"
  | "SLA_WARNING"
  | "SESSION_STARTED"
  | "GAME_ANOMALY"
  | "STRIKE_ADDED"
  | "FINE_ISSUED"
  | "FINE_APPEAL_DECIDED"
  | "INACTIVITY_WARNING"
  | "PAYOUT_METHOD_CHANGED"
  | "REVIEW_RECEIVED"
  | "TIP_RECEIVED"
  | "ACCOUNT_DELETION_REQUESTED"
  | "COMPLETION_REVIEW"
  | "COMPLETION_SUBMITTED"
  | "COMPLETION_DISPUTED"
  | "COMPLETION_SENT_BACK"
  | "PROGRESS_UPDATE_DUE"
  | "CHAT_FLAGGED"
  // Admin alerts (2026-11-24), stored under existing types (no enum migration).
  | "SYSTEM_JOB_ALERT"
  | "ORDER_UNCLAIMED"
  | "COMPLETION_WAITING"
  | "SUPPORT_TICKET_WAITING"
  // Stalled orders (2026-11-24), stored under existing types.
  | "STALL_NO_CONTACT"
  | "STALL_WARNING"
  | "STALL_FINAL_WARNING"
  | "ORDER_AUTO_RELEASED";

export interface NotificationEventMetadata {
  orderId?: string;
  senderName?: string;
  ticketSubject?: string;
  newStatus?: string;
  [key: string]: unknown;
}

export interface NotificationEvent {
  type: NotificationEventType;
  orderId?: string;
  assignmentId?: string;
  ticketId?: string;
  metadata?: NotificationEventMetadata;
  actorId: string;
  /**
   * Idempotency key for one-shot lifecycle events. When set, each recipient
   * receives at most one notification with this key (enforced by the
   * notification(userId, dedupeKey) unique index), so retries and races never
   * produce duplicates.
   */
  dedupeKey?: string;
}

export interface NotificationRecipientRule {
  eventType: NotificationEventType;
  getRecipients: (event: NotificationEvent, prisma: any) => Promise<string[]>;
  /**
   * By default the actor never notifies themself. Set for events where the
   * actor must also get a persistent record (e.g. the booster who completed
   * an order receives the completion notification).
   */
  notifyActor?: boolean;
}

/**
 * Event types that are stored under an existing database NotificationType
 * (so no enum migration is needed). Everything else is stored as itself.
 */
const NOTIFICATION_STORED_AS = {
  ORDER_PAUSED_BY_CUSTOMER: "ORDER_PROGRESS_UPDATED",
  ORDER_RESUMED_BY_CUSTOMER: "ORDER_PROGRESS_UPDATED",
  BOOSTER_CHANGE_REQUESTED: "BOOSTER_REASSIGNED",
  SYSTEM_JOB_ALERT: "FINANCE_ALERT",
  ORDER_UNCLAIMED: "SLA_WARNING",
  COMPLETION_WAITING: "COMPLETION_REVIEW",
  SUPPORT_TICKET_WAITING: "SUPPORT_TICKET_CREATED",
  STALL_NO_CONTACT: "SLA_WARNING",
  STALL_WARNING: "INACTIVITY_WARNING",
  STALL_FINAL_WARNING: "INACTIVITY_WARNING",
  ORDER_AUTO_RELEASED: "BOOSTER_REMOVED",
} as const;

/** Event types that exist as database NotificationType values. */
export type StoredNotificationType = Exclude<NotificationEventType, keyof typeof NOTIFICATION_STORED_AS>;

export function storedNotificationType(type: NotificationEventType): StoredNotificationType {
  return type in NOTIFICATION_STORED_AS
    ? NOTIFICATION_STORED_AS[type as keyof typeof NOTIFICATION_STORED_AS]
    : (type as StoredNotificationType);
}

export const NOTIFICATION_TITLES: Record<NotificationEventType, string> = {
  ORDER_CREATED: "New Order Created",
  ORDER_CANCELLED: "Order Cancelled",
  ORDER_STARTED: "Order Started",
  ORDER_PROGRESS_UPDATED: "Order Progress Updated",
  ORDER_PAUSED_BY_CUSTOMER: "Order Paused - Stop Boosting",
  ORDER_RESUMED_BY_CUSTOMER: "Order Resumed",
  ORDER_COMPLETED: "Order Completed",
  ORDER_REOPENED: "Order Reopened",
  BOOSTER_ASSIGNED: "Booster Assigned",
  BOOSTER_ACCEPTED: "Booster Accepted Assignment",
  BOOSTER_REJECTED: "Booster Rejected Assignment",
  BOOSTER_REASSIGNED: "Booster Reassigned",
  BOOSTER_REMOVED: "Booster Removed",
  BOOSTER_ABANDONED: "Booster Abandoned Order",
  BOOSTER_CHANGE_REQUESTED: "Booster Change Requested",
  NEW_MESSAGE: "New Message",
  SUPPORT_REPLY: "Support Reply",
  SUPPORT_STATUS_UPDATED: "Support Ticket Status Updated",
  SUPPORT_TICKET_CREATED: "New Support Ticket",
  SUPPORT_TICKET_RESOLVED: "Support Ticket Resolved",
  PAYMENT_SUCCEEDED: "Payment Confirmed",
  PAYMENT_FAILED: "Payment Not Completed",
  REFUND_ISSUED: "Refund Issued",
  EARNING_AVAILABLE: "Earnings Available",
  PAYOUT_UPDATED: "Payout Updated",
  FINANCE_ALERT: "Finance Review Needed",
  ORDER_OFFERED: "A Customer Chose You",
  BID_WON: "Bid Won",
  BID_LOST: "Bid Not Selected",
  SLA_WARNING: "Order Waiting On You",
  SESSION_STARTED: "Booster Started Playing",
  GAME_ANOMALY: "Game Outside A Session",
  STRIKE_ADDED: "Strike Added",
  FINE_ISSUED: "Fine Issued",
  FINE_APPEAL_DECIDED: "Fine Appeal Decided",
  INACTIVITY_WARNING: "Order Inactive",
  PAYOUT_METHOD_CHANGED: "Payout Method Changed",
  REVIEW_RECEIVED: "New Review",
  TIP_RECEIVED: "You Got A Tip",
  ACCOUNT_DELETION_REQUESTED: "Account Deletion Requested",
  COMPLETION_REVIEW: "Completion To Review",
  COMPLETION_SUBMITTED: "Your Order Is Done",
  COMPLETION_DISPUTED: "Completion Disputed",
  COMPLETION_SENT_BACK: "Order Sent Back",
  PROGRESS_UPDATE_DUE: "Update The Rank",
  CHAT_FLAGGED: "Chat Message Flagged",
  SYSTEM_JOB_ALERT: "Scheduled Job Problem",
  ORDER_UNCLAIMED: "Order Waiting For A Booster",
  COMPLETION_WAITING: "Completion Still Waiting",
  SUPPORT_TICKET_WAITING: "Ticket Waiting For A Reply",
  STALL_NO_CONTACT: "Message Your Customer Now",
  STALL_WARNING: "Order Needs Activity",
  STALL_FINAL_WARNING: "Order Taken Back In 1 Hour",
  ORDER_AUTO_RELEASED: "Order Taken Back",
};

export const NOTIFICATION_MESSAGES: Record<NotificationEventType, (metadata?: NotificationEventMetadata) => string> = {
  ORDER_CREATED: () => "Your order has been created and is pending assignment.",
  ORDER_CANCELLED: (meta) => `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been cancelled.`,
  ORDER_STARTED: (meta) => `Work has started on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  ORDER_PROGRESS_UPDATED: (meta) =>
    meta?.rank
      ? `Your booster updated order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}: now ${String(meta.rank)}.`
      : `Progress update on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  ORDER_PAUSED_BY_CUSTOMER: (meta) =>
    `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} paused by the customer. Stop boosting immediately. Do not continue playing on the customer's account until the order is resumed.`,
  ORDER_RESUMED_BY_CUSTOMER: (meta) =>
    `The customer has resumed order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. You may continue boosting.`,
  ORDER_COMPLETED: (meta) => `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been marked as complete.`,
  ORDER_REOPENED: (meta) => `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been reopened.`,
  BOOSTER_ASSIGNED: (meta) => `A booster has been assigned to your order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  BOOSTER_ACCEPTED: (meta) => `The booster has accepted order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  BOOSTER_REJECTED: (meta) => `The booster has rejected order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  BOOSTER_REASSIGNED: (meta) => `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been reassigned to a new booster.`,
  BOOSTER_REMOVED: (meta) => `The booster has been removed from order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  BOOSTER_ABANDONED: (meta) => `The booster has abandoned order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  BOOSTER_CHANGE_REQUESTED: (meta) =>
    `The customer of order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} asked for a different booster. Open the order to decide.`,
  NEW_MESSAGE: (meta) => `New message from ${meta?.senderName ?? "the other party"} on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  SUPPORT_REPLY: (meta) => `New reply on your support ticket "${meta?.ticketSubject ?? ""}".`,
  SUPPORT_STATUS_UPDATED: (meta) => `Your support ticket "${meta?.ticketSubject ?? ""}" status changed to ${meta?.newStatus ?? ""}.`,
  SUPPORT_TICKET_CREATED: (meta) => `New support ticket created: ${meta?.ticketSubject ?? ""}.`,
  SUPPORT_TICKET_RESOLVED: (meta) => `Your support ticket "${meta?.ticketSubject ?? ""}" has been resolved.`,
  PAYMENT_SUCCEEDED: (meta) => `Payment received for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. Your order is now available to our boosters.`,
  PAYMENT_FAILED: (meta) => `The payment for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} did not complete. You can try again from your order.`,
  REFUND_ISSUED: (meta) => `A refund was issued for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  EARNING_AVAILABLE: (meta) => `Earnings for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} are now available for payout.`,
  PAYOUT_UPDATED: (meta) => `Your payout request is now ${String(meta?.newStatus ?? "updated").toLowerCase()}.`,
  FINANCE_ALERT: (meta) => `Finance review needed: ${String(meta?.reason ?? "see the finance dashboard")}.`,
  ORDER_OFFERED: (meta) =>
    `A customer chose you for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. It is yours to claim for ${String(meta?.minutes ?? 30)} minutes before it goes to the pool.`,
  BID_WON: (meta) => `You won order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. Message the customer and start the order.`,
  BID_LOST: (meta) => `Another booster won order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  SLA_WARNING: (meta) =>
    meta?.kind === "start"
      ? `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has not been started yet. Start it now or release it.`
      : `You have not messaged the customer on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} yet.`,
  SESSION_STARTED: (meta) =>
    `Your booster started a session on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. Please do not log in to your account until the session ends.`,
  STRIKE_ADDED: (meta) => `You received a strike: ${String(meta?.reason ?? "rule breach")}.`,
  FINE_ISSUED: (meta) =>
    `You received a fine of ${String(meta?.amount ?? "")} on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}: ${String(meta?.reason ?? "")}. You can appeal it from your profile.`,
  FINE_APPEAL_DECIDED: (meta) =>
    meta?.accepted ? "Your fine appeal was accepted and the fine was refunded." : "Your fine appeal was rejected.",
  REVIEW_RECEIVED: (meta) => `A customer rated order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} ${String(meta?.rating ?? "")}/5. You can reply on the order page.`,
  ACCOUNT_DELETION_REQUESTED: () => "A user asked to delete their account. Review it in Admin, Users.",
  TIP_RECEIVED: (meta) => `A customer tipped you ${String(meta?.amount ?? "")} on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  PAYOUT_METHOD_CHANGED: (meta) =>
    `Your payout method was changed to ${String(meta?.hint ?? "a new method")}. Payouts are paused for 48 hours. If this was not you, contact support now.`,
  INACTIVITY_WARNING: (meta) =>
    `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has had no games and no messages for ${String(meta?.hours ?? 12)} hours.`,
  GAME_ANOMALY: (meta) =>
    `A ranked game was played on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} ${meta?.playedBy === "PAUSED" ? "while the order was paused" : "outside a booster session"}.`,
  COMPLETION_REVIEW: (meta) =>
    `The booster sent the completion screenshots for order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. Check them and mark the order Completed.`,
  COMPLETION_SUBMITTED: (meta) =>
    `Your booster finished order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. See the screenshots on your order page; our team is checking them. Something wrong? Report a problem.`,
  COMPLETION_DISPUTED: (meta) =>
    `The customer reported a problem with the completion of order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}. An admin will review it.`,
  COMPLETION_SENT_BACK: (meta) =>
    `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} was sent back to the booster${meta?.note ? `: ${String(meta.note)}` : "."}`,
  PROGRESS_UPDATE_DUE: (meta) =>
    `No rank update on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} for ${String(meta?.hours ?? 24)} hours. Post the current rank so the customer can follow the progress.`,
  SYSTEM_JOB_ALERT: (meta) =>
    meta?.problem === "failed"
      ? `The scheduled job "${String(meta?.job ?? "")}" failed: ${String(meta?.error ?? "unknown error")}. Check the logs.`
      : `The scheduled job "${String(meta?.job ?? "")}" has not run for ${String(meta?.minutes ?? "")} minutes. Check cron-job.org.`,
  ORDER_UNCLAIMED: (meta) =>
    meta?.audience === "booster"
      ? `Order #${meta?.ref ?? ""} (${String(meta?.service ?? "")}) is still waiting for a booster. You can claim it in Available Orders.`
      : `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has had no booster for ${String(meta?.minutes ?? "")} minutes since it was paid or released.`,
  COMPLETION_WAITING: (meta) =>
    `${meta?.disputed ? "A disputed completion" : "A completion"} on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been waiting ${String(meta?.hours ?? "")} hours for an admin decision. Open Admin, Completions.`,
  SUPPORT_TICKET_WAITING: (meta) =>
    `The support ticket "${meta?.ticketSubject ?? ""}" has been waiting ${String(meta?.hours ?? "")} hours for a reply. Open Admin, Support.`,
  CHAT_FLAGGED: (meta) =>
    `A message on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} contained ${String(meta?.kinds ?? "contact details")}; it was hidden.`,
  STALL_NO_CONTACT: (meta) =>
    `You took order #${ref(meta)} ${String(meta?.minutes ?? 45)} minutes ago and have not messaged the customer yet. Say hello in the order chat now.`,
  STALL_WARNING: (meta) =>
    `No messages, games or rank updates on order #${ref(meta)} for ${String(meta?.hours ?? 2)} hours. After ${String(meta?.releaseHours ?? 24)} hours without activity the order is taken back and you are fined.`,
  STALL_FINAL_WARNING: (meta) =>
    `Order #${ref(meta)} has had no activity for ${String(meta?.hours ?? 23)} hours. Message the customer or play now, or it will be taken back in 1 hour and you will be fined.`,
  ORDER_AUTO_RELEASED: (meta) =>
    meta?.audience === "booster"
      ? `Order #${ref(meta)} was taken back after ${String(meta?.hours ?? 24)} hours without activity. Fine: ${String(meta?.fine ?? "none")}${meta?.repeat ? ` (doubled: ${String(meta.repeat)} orders taken back in 30 days)` : ""}. You can appeal it on Fines/Abandoned Orders.${meta?.blocked ? " You cannot take new orders until our team reviews your account." : ""}`
      : meta?.audience === "customer"
        ? meta?.toPool
          ? `Your booster was inactive, so order #${ref(meta)} is back on the marketplace and a new booster will take it shortly.`
          : `Your booster was inactive, so we took order #${ref(meta)} back. Our team will assign a new booster and keep your progress.`
        : `Order #${ref(meta)} was taken back from its booster after ${String(meta?.hours ?? 24)} hours without activity (${meta?.toPool ? "back in the pool" : "moved to draft for review"}). Fine: ${String(meta?.fine ?? "none")}.${meta?.blocked ? " The booster can no longer take new orders: lift it on their admin page." : ""}`,
};

function ref(meta?: NotificationEventMetadata) {
  return meta?.orderId?.slice(-8).toUpperCase() ?? "";
}