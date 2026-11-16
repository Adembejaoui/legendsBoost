import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { verifyEmail } from "@/lib/auth/email-tokens";

export const metadata: Metadata = {
  title: "Confirm your email — LegendsBoost",
  robots: { index: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/** Opening the link from the email confirms the address. */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  let ok = false;
  try {
    ok = typeof token === "string" && token.length > 0 ? await verifyEmail(token) : false;
  } catch {
    ok = false;
  }
  return (
    <AuthShell
      title={ok ? "Email confirmed" : "This link did not work"}
      subtitle={ok ? "Thank you, your email address is confirmed" : "It may have expired or been used already"}
      sideHeading="One less thing to do."
      sideNote="A confirmed email lets us reach you about your orders and helps you recover your account."
    >
      <div className="space-y-4 text-sm">
        {ok ? (
          <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">You are all set. You can close this page or go to your dashboard.</p>
        ) : (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
            Confirmation links work once and expire after 48 hours. Sign in and use &quot;Send the email again&quot; at the top of your dashboard to get a new
            one. If your email is already confirmed, there is nothing to do.
          </p>
        )}
        <Link href="/dashboard" className="inline-block text-[#C8AA6E] hover:underline">
          Go to my dashboard
        </Link>
      </div>
    </AuthShell>
  );
}
