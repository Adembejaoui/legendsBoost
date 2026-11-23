import { NextResponse } from "next/server";
import { readJson, requireRole } from "@/lib/finance/http";
import { deleteBlogPost, getBlogPostAdmin, updateBlogPost } from "@/lib/blog/service";
import { blogErrorResponse } from "@/lib/blog/http";

type Ctx = { params: Promise<{ postId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  const data = await getBlogPostAdmin((await params).postId);
  if (!data) return NextResponse.json({ error: "Post not found." }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

/** Admin: save a post (the whole form; publishing is status PUBLISHED). */
export async function PUT(req: Request, { params }: Ctx) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    return NextResponse.json({ post: await updateBlogPost(g.user.id, (await params).postId, await readJson(req)) });
  } catch (e) {
    return blogErrorResponse(e);
  }
}

/** Admin: delete one language version of a post (permanent). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    await deleteBlogPost(g.user.id, (await params).postId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return blogErrorResponse(e);
  }
}
