import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = {
  title: "Register — LegendsBoost",
  description: "Create your LegendsBoost account.",
};

export default function RegisterPage() {
  return (
    <AuthShell
      title="Create your account"
      subtitle="Start your climb with LegendsBoost"
      sideHeading="Pick your target rank. Track the climb."
      sideNote="Create an account to order a boost and follow every order from your dashboard."
    >
      <RegisterForm />
    </AuthShell>
  );
}