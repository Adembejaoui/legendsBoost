import { Link } from "@/i18n/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * Simple page for content that is not published yet (legal texts, password
 * reset). Keeps links working instead of a 404, and says clearly what is
 * missing.
 */
export function PlaceholderPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto min-h-[60dvh] max-w-2xl px-5 pb-16 pt-28 text-white">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-400">{children}</div>
        <Link href="/" className="mt-8 inline-flex rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5">
          Back to home
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
