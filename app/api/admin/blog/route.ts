import { NextResponse } from "next/server";
import { readJson, requireRole } from "@/lib/finance/http";
import { createBlogPost, listBlogPostsAdmin } from "@/lib/blog/service";
import { blogErrorResponse } from "@/lib/blog/http";

/** Admin: every blog post (all languages, drafts included). */
export async function GET() {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  return NextResponse.json({ posts: await listBlogPostsAdmin() }, { headers: { "Cache-Control": "no-store" } });
}

/** Admin: new post. `?translationOf=<postId>` adds it as another language of that article. */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const translationOf = new URL(req.url).searchParams.get("translationOf") ?? undefined;
    return NextResponse.json({ post: await createBlogPost(g.user.id, await readJson(req), translationOf) }, { status: 201 });
  } catch (e) {
    return blogErrorResponse(e);
  }
}
