import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password — LegendsBoost",
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to choose a new one"
      sideHeading="Back in a minute."
      sideNote="The link works once and expires in 1 hour. If you signed up with Google, you can simply sign in with Google."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
