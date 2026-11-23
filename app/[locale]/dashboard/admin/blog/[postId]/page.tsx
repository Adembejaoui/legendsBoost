import { notFound, redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { getBlogPostAdmin } from "@/lib/blog/service";
import { blogEditorOptions } from "@/lib/blog/admin-options";
import { BlogEditor } from "@/components/blog/admin/BlogEditor";

export const dynamic = "force-dynamic";

/** Admin: edit one language version of an article. */
export default async function EditBlogPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const data = await getBlogPostAdmin((await params).postId);
  if (!data) notFound();
  const { post, translations } = data;
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 text-white">
      <div className="flex items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-semibold">Edit article</h1>
        <Link href="/dashboard/admin/blog" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">
          Back to the blog
        </Link>
      </div>
      <BlogEditor
        key={post.id}
        initial={{
          id: post.id,
          locale: post.locale,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          coverImageId: post.coverImageId,
          gameSlug: post.gameSlug,
          tags: post.tags,
          status: post.status,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          seoTitle: post.seoTitle,
          seoDescription: post.seoDescription,
        }}
        translations={translations}
        {...blogEditorOptions()}
      />
    </div>
  );
}
