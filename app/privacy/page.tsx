import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/layout/PlaceholderPage";

export const metadata: Metadata = { title: "Privacy Policy — LegendsBoost" };

// PLACEHOLDER: replace with the reviewed privacy policy (build plan Phase 1).
export default function PrivacyPage() {
  return (
    <PlaceholderPage title="Privacy Policy">
      <p>Our full Privacy Policy is being finalised and will be published here soon.</p>
      <p>
        In short: we use your data only to run your orders and your account. Game-account logins you share for an order are
        encrypted, can only be opened by the booster working on that order, and are deleted when the order is completed or
        cancelled. Payments are handled by Stripe; we never see or store your card details.
      </p>
    </PlaceholderPage>
  );
}
