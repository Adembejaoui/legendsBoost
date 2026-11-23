import { NextResponse } from "next/server";
import { requireRole } from "@/lib/finance/http";
import { uploadBlogImage } from "@/lib/blog/images";
import { blogErrorResponse } from "@/lib/blog/http";

/** Admin: upload one image (form field "file"); returns its id and public address. */
export async function POST(req: Request) {
  const g = await requireRole("ADMIN");
  if (!g.ok) return g.response;
  try {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
    return NextResponse.json({ image: await uploadBlogImage(g.user.id, file) }, { status: 201 });
  } catch (e) {
    return blogErrorResponse(e);
  }
}
