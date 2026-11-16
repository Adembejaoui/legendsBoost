import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password — LegendsBoost",
  robots: { index: false },
  // The link carries a secret: never send it to other sites.
  referrer: "no-referrer",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Choose a new password"
      subtitle="All devices are signed out when you save it"
      sideHeading="A fresh start."
      sideNote="Use a password you do not use anywhere else, at least 8 characters."
    >
      <ResetPasswordForm token={typeof token === "string" ? token : ""} />
    </AuthShell>
  );
}
