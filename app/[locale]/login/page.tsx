import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.login");
  return { title: t("metaTitle"), description: t("metaDescription"), robots: { index: false, follow: true } };
}

export default function LoginPage() {
  const t = useTranslations("Auth.login");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")} sideHeading={t("sideHeading")} sideNote={t("sideNote")}>
      <LoginForm />
    </AuthShell>
  );
}