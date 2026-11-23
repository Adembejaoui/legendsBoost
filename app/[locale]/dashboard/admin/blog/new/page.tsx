import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getBlogPostAdmin } from "@/lib/blog/service";
import { blogEditorOptions } from "@/lib/blog/admin-options";
import { BlogEditor, type EditorPost } from "@/components/blog/admin/BlogEditor";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** Admin: new article, or a new language version (?translationOf=<id>&locale=fr). */
export default async function NewBlogPostPage({ searchParams }: { searchParams: Promise<{ translationOf?: string; locale?: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const sp = await searchParams;
  const source = sp.translationOf ? await getBlogPostAdmin(sp.translationOf) : null;
  if (sp.translationOf && !source) notFound();
  const locale = (routing.locales as readonly string[]).includes(sp.locale ?? "") ? (sp.locale as string) : routing.defaultLocale;
  const initial: EditorPost = {
    locale,
    slug: "",
    title: "",
    excerpt: "",
    // A translation starts from the original text, ready to be translated.
    body: source?.post.body ?? "",
    coverImageId: source?.post.coverImageId ?? null,
    gameSlug: source?.post.gameSlug ?? null,
    tags: source?.post.tags ?? [],
    status: "DRAFT",
    publishedAt: null,
    seoTitle: null,
    seoDescription: null,
  };
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{source ? `Translate: ${source.post.title}` : "New article"}</h1>
        <Link href="/dashboard/admin/blog" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">
          Back to the blog
        </Link>
      </div>
      <BlogEditor initial={initial} translationOf={source?.post.id} translations={[]} {...blogEditorOptions()} />
    </div>
  );
}
