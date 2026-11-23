import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.forgot");
  return { title: t("metaTitle"), robots: { index: false } };
}

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth.forgot");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")} sideHeading={t("sideHeading")} sideNote={t("sideNote")}>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
