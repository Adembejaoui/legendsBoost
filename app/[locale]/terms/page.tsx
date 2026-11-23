import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";
import { RISK_DISCLOSURE_TEXT } from "@/lib/orders/risk-disclosure";

// Not indexed while the page is a placeholder (thin content); remove robots when the real text is in.
export const metadata: Metadata = { title: "Terms of Service — LegendsBoost", robots: { index: false, follow: true } };

// PLACEHOLDER: replace with the reviewed legal text (build plan Phase 1).
export default function TermsPage() {
  return (
    <PlaceholderPage title="Terms of Service">
      <p>Our full Terms of Service are being finalised and will be published here soon.</p>
      <p>
        Until then, the key points: an order is created only once your payment is confirmed; you can pause an order at any time
        and ask our team to cancel it; approved cancellations are refunded for the part of the work not yet done.
      </p>
      <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-amber-100/90">{RISK_DISCLOSURE_TEXT}</p>
    </PlaceholderPage>
  );
}
