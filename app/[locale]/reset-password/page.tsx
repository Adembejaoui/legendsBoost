import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.reset");
  return {
    title: t("metaTitle"),
    robots: { index: false },
    // The link carries a secret: never send it to other sites.
    referrer: "no-referrer",
  };
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const t = await getTranslations("Auth.reset");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")} sideHeading={t("sideHeading")} sideNote={t("sideNote")}>
      <ResetPasswordForm token={typeof token === "string" ? token : ""} />
    </AuthShell>
  );
}
