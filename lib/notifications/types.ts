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
  | "CHAT_FLAGGED";

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
  COMPLETION_REVIEW: "Completion Needs Review",
  CHAT_FLAGGED: "Chat Message Flagged",
};

export const NOTIFICATION_MESSAGES: Record<NotificationEventType, (metadata?: NotificationEventMetadata) => string> = {
  ORDER_CREATED: () => "Your order has been created and is pending assignment.",
  ORDER_CANCELLED: (meta) => `Order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} has been cancelled.`,
  ORDER_STARTED: (meta) => `Work has started on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
  ORDER_PROGRESS_UPDATED: (meta) => `Progress update on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""}.`,
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
    `The booster marked order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} as complete but it could not be confirmed (${String(meta?.reason ?? "check needed")}). Contact the booster.`,
  CHAT_FLAGGED: (meta) =>
    `A message on order #${meta?.orderId?.slice(-8).toUpperCase() ?? ""} contained ${String(meta?.kinds ?? "contact details")}; it was hidden.`,
};