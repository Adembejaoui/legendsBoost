import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — LegendsBoost",
  description: "Sign in to your LegendsBoost account.",
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your LegendsBoost account"
      sideHeading="Pick up where you left off."
      sideNote="Sign in to check on your orders or start a new boost."
    >
      <LoginForm />
    </AuthShell>
  );
}