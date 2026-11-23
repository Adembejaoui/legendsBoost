import { readBlogImage } from "@/lib/blog/images";

/** Public blog image. Ids never change content, so browsers and CDNs cache them for a year. */
export async function GET(_req: Request, { params }: { params: Promise<{ imageId: string }> }) {
  const { imageId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(imageId)) return new Response("Not found", { status: 404 });
  const img = await readBlogImage(imageId).catch(() => null);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(img.bytes), {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
