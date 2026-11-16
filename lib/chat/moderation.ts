/**
 * Chat moderation filter v1 [registry F13] (decision 2026-11-15: hide and
 * flag). Contact and payment details are replaced with "[hidden]" before the
 * message is stored or shown; the original text is kept for admins only
 * (ChatModerationFlag) and admins are notified. Admin messages are exempt.
 *
 * Detected: email addresses (also "name at gmail dot com"), phone numbers
 * (8+ digits), Discord invites / handles, messenger links and handles
 * (Telegram, WhatsApp, Snapchat, Instagram, Skype), and payment details
 * (PayPal / Cash App / Venmo / Revolut / Skrill / Wise / Zelle, IBAN,
 * Bitcoin and Ethereum addresses).
 */

export type ModerationKind = "EMAIL" | "PHONE" | "DISCORD" | "MESSENGER" | "PAYMENT";

export const HIDDEN = "[hidden]";

const RULES: { kind: ModerationKind; re: RegExp; check?: (m: string) => boolean }[] = [
  { kind: "EMAIL", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  {
    kind: "EMAIL",
    re: /\b[\w.+-]+\s*(?:\(at\)|\[at\]|\sat\s)\s*(?:gmail|hotmail|outlook|yahoo|icloud|live|proton(?:mail)?)\s*(?:\.|\(dot\)|\[dot\]|\sdot\s)\s*[a-z]{2,}\b/gi,
  },
  { kind: "DISCORD", re: /\b(?:discord(?:app)?\.(?:gg|com|me)|dsc\.gg)\/\S+/gi },
  { kind: "DISCORD", re: /\b[\w.]{2,32}#\d{4}\b/g },
  { kind: "DISCORD", re: /\b(?:discord|dc)\s*(?:id|tag|name|user(?:name)?)?\s*(?:[:=]|is\s*@|@)\s*@?[\w.]{2,32}/gi },
  { kind: "MESSENGER", re: /\b(?:t\.me|telegram\.me|wa\.me|chat\.whatsapp\.com|snapchat\.com\/add|instagram\.com)\/\S+/gi },
  {
    kind: "MESSENGER",
    re: /\b(?:telegram|tg|whatsapp|wa|snap(?:chat)?|insta(?:gram)?|ig|skype)\s*(?:id|name|user(?:name)?)?\s*(?:[:=]|is\s*@|@)\s*@?[\w.+]{2,32}/gi,
  },
  { kind: "PAYMENT", re: /\b(?:paypal\.me|cash\.app|venmo\.com|revolut\.me)\/\S+/gi },
  { kind: "PAYMENT", re: /\b(?:paypal|cash\s?app|venmo|revolut|skrill|zelle|western\s?union|moneygram)\b/gi },
  { kind: "PAYMENT", re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g },
  { kind: "PAYMENT", re: /\b(?:bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g },
  { kind: "PAYMENT", re: /\b0x[a-fA-F0-9]{40}\b/g },
  // Phone numbers last (after IBAN / addresses): 8 to 15 digits with separators.
  {
    kind: "PHONE",
    re: /(?:\+|\b00)?\d[\d\s().-]{6,}\d/g,
    check: (m) => {
      const digits = m.replace(/\D/g, "").length;
      return digits >= 8 && digits <= 15;
    },
  },
];

export interface ModerationResult {
  text: string;
  kinds: ModerationKind[];
}

export function moderateChatText(input: string): ModerationResult {
  let text = input;
  const kinds = new Set<ModerationKind>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (m) => {
      if (m === HIDDEN || (rule.check && !rule.check(m))) return m;
      kinds.add(rule.kind);
      return HIDDEN;
    });
  }
  return { text, kinds: [...kinds] };
}

export const MODERATION_NOTICE =
  "Contact and payment details are not allowed in the chat and were hidden. Keep all communication and payments on LegendsBoost.";
