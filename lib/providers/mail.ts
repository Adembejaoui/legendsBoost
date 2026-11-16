// Server-only module.
/**
 * Mailer: transactional email. Phase 1 adds a real provider (Resend or
 * Postmark) behind this interface. Until then mail is only logged (tag and
 * subject, never the body or the address), so nothing is silently "sent".
 */
import { logger } from "@/lib/logger";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Short machine tag for logs and metrics, e.g. "payment-confirmed". */
  tag: string;
}

export interface Mailer {
  readonly kind: "log" | "fake" | "resend" | "postmark";
  send(message: MailMessage): Promise<{ id: string | null }>;
}

export class LogMailer implements Mailer {
  readonly kind = "log" as const;
  async send(m: MailMessage) {
    logger.info("Email not sent (no mail provider configured)", { tag: m.tag, subject: m.subject });
    return { id: null };
  }
}

/** Collects messages in memory (tests). */
export class FakeMailer implements Mailer {
  readonly kind = "fake" as const;
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    return { id: `fake-${this.sent.length}` };
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  mailer ??= new LogMailer();
  return mailer;
}

/** Swap the mailer (tests; Phase 1 wiring). */
export function setMailer(m: Mailer | null) {
  mailer = m;
}
