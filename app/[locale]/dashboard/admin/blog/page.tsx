import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listBlogPostsAdmin } from "@/lib/blog/service";
import { getGame } from "@/lib/catalog/games";
import { LOCALE_NAMES, routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Admin: every article with its language versions. */
export default async function AdminBlogPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const posts = await listBlogPostsAdmin();
  const groups = new Map<string, typeof posts>();
  for (const p of posts) groups.set(p.translationGroup, [...(groups.get(p.translationGroup) ?? []), p]);
  const now = new Date();
  const status = (p: (typeof posts)[number]) =>
    p.status !== "PUBLISHED"
      ? { label: "Draft", cls: "bg-white/10 text-zinc-300" }
      : p.publishedAt && p.publishedAt > now
        ? { label: "Scheduled", cls: "bg-amber-500/15 text-amber-300" }
        : { label: "Published", cls: "bg-emerald-500/15 text-emerald-300" };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Blog</h1>
          <p className="text-sm text-zinc-400">Articles in Markdown, one version per language. Published articles appear on /blog and in the sitemap.</p>
        </div>
        <Link href="/dashboard/admin/blog/new" className="rounded-md bg-violet-500 px-4 py-2 text-sm font-semibold hover:bg-violet-400">
          New article
        </Link>
      </div>
      {groups.size === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 p-10 text-center text-sm text-zinc-500">No articles yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="px-3 py-2">Article</th>
                <th className="px-3 py-2">Game</th>
                {routing.locales.map((l) => (
                  <th key={l} className="px-3 py-2">{LOCALE_NAMES[l]}</th>
                ))}
                <th className="px-3 py-2">Last change</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.values()].map((versions) => {
                const main = versions.find((v) => v.locale === routing.defaultLocale) ?? versions[0];
                return (
                  <tr key={main.translationGroup} className="border-b border-white/[0.06] align-top">
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/admin/blog/${main.id}`} className="font-medium hover:underline">
                        {main.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{main.gameSlug ? (getGame(main.gameSlug)?.shortName ?? main.gameSlug) : "General"}</td>
                    {routing.locales.map((l) => {
                      const v = versions.find((x) => x.locale === l);
                      if (!v)
                        return (
                          <td key={l} className="px-3 py-2">
                            <Link href={`/dashboard/admin/blog/new?translationOf=${main.id}&locale=${l}`} className="text-xs text-zinc-500 hover:text-white">
                              + Add
                            </Link>
                          </td>
                        );
                      const s = status(v);
                      return (
                        <td key={l} className="px-3 py-2">
                          <Link href={`/dashboard/admin/blog/${v.id}`} className={`rounded-full px-2 py-0.5 text-xs ${s.cls}`}>
                            {s.label}
                          </Link>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-zinc-400">{new Date(Math.max(...versions.map((v) => v.updatedAt.getTime()))).toISOString().slice(0, 10)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
