import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-4 text-center text-white">
      <p className="text-sm font-semibold tracking-[0.2em] text-[#C8AA6E]">404</p>
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="max-w-md text-sm text-zinc-400">
        {t("text")}
      </p>
      <div className="flex gap-2">
        <Link href="/" className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5">
          {t("home")}
        </Link>
        <Link href="/dashboard" className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85]">
          {t("dashboard")}
        </Link>
      </div>
    </main>
  );
}
