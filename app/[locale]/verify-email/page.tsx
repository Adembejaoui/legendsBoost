import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { verifyEmail } from "@/lib/auth/email-tokens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.verify");
  return { title: t("metaTitle"), robots: { index: false }, referrer: "no-referrer" };
}
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
  const t = await getTranslations("Auth.verify");
  return (
    <AuthShell
      title={ok ? t("okTitle") : t("badTitle")}
      subtitle={ok ? t("okSubtitle") : t("badSubtitle")}
      sideHeading={t("sideHeading")}
      sideNote={t("sideNote")}
    >
      <div className="space-y-4 text-sm">
        {ok ? (
          <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-4 text-emerald-100">{t("ok")}</p>
        ) : (
          <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
            {t("bad")}
          </p>
        )}
        <Link href="/dashboard" className="inline-block text-[#C8AA6E] hover:underline">
          {t("dashboard")}
        </Link>
      </div>
    </AuthShell>
  );
}
