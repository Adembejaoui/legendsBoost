import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { useTranslations } from "next-intl";
import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.register");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default function RegisterPage() {
  const t = useTranslations("Auth.register");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")} sideHeading={t("sideHeading")} sideNote={t("sideNote")}>
      <RegisterForm />
    </AuthShell>
  );
}