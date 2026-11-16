// Server-only module.
/**
 * Notifier [registry F14]: one call for "tell these users about this event",
 * whatever the channels. v1 = in-app notifications (existing service).
 * Phase 1 adds email through the Mailer; Phase 8 adds Discord, preferences
 * and quiet hours. New code should call notify() instead of a channel.
 */
import { createNotification } from "@/lib/notifications/service";
import type { NotificationEventType } from "@/lib/notifications/types";

export interface NotifyEvent {
  type: NotificationEventType;
  orderId?: string;
  actorId: string;
  metadata?: Record<string, unknown>;
  /** Idempotency: the same key never notifies the same user twice. */
  dedupeKey?: string;
}

export interface Notifier {
  notify(event: NotifyEvent, recipients: string[]): Promise<void>;
}

export class InAppNotifier implements Notifier {
  async notify(e: NotifyEvent, recipients: string[]) {
    for (const userId of recipients) {
      await createNotification(userId, e.type, e.orderId, e.metadata, e.actorId, {
        includeActor: true,
        ...(e.dedupeKey ? { dedupeKey: `${e.dedupeKey}:${userId}` } : {}),
      });
    }
  }
}

export function getNotifier(): Notifier {
  return new InAppNotifier();
}
