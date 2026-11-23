// Server-only module.
/**
 * Blog images (2026-11-23). Stored in the PRIVATE Supabase bucket
 * "blog-images" and served publicly by GET /api/blog/images/[id] (same
 * origin, so the Content-Security-Policy does not change). Files are checked
 * by their first bytes (PNG / JPEG / WebP) like completion screenshots.
 */
import { randomUUID } from "node:crypto";
import prisma from "@/lib/prisma";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sniffImageType } from "@/lib/storage/order-proofs";
import { BlogError } from "./service";
import { blogImageUrl } from "./image-url";

export { blogImageUrl };

export const BLOG_BUCKET = "blog-images";
/** Vercel refuses request bodies over 4.5 MB. */
export const BLOG_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export interface BlogImageStore {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
}

let bucketReady = false;

function supabaseStore(): BlogImageStore {
  const admin = () => {
    const c = getSupabaseAdmin();
    if (!c) throw new BlogError("Image uploads are not configured on the server.", 503);
    return c;
  };
  async function ensureBucket() {
    if (bucketReady) return;
    const c = admin();
    const { data } = await c.storage.getBucket(BLOG_BUCKET);
    if (!data) {
      const { error } = await c.storage.createBucket(BLOG_BUCKET, { public: false, fileSizeLimit: BLOG_IMAGE_MAX_BYTES, allowedMimeTypes: Object.keys(EXT) });
      if (error && !/already exists/i.test(error.message)) throw new BlogError("Could not prepare image storage.", 503);
    }
    bucketReady = true;
  }
  return {
    async put(path, bytes, contentType) {
      await ensureBucket();
      const { error } = await admin().storage.from(BLOG_BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new BlogError("Could not upload the image. Try again.", 502);
    },
    async get(path) {
      const { data, error } = await admin().storage.from(BLOG_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

let store: BlogImageStore | null = null;
export function blogImageStore(): BlogImageStore {
  store ??= supabaseStore();
  return store;
}
/** Tests: swap the store for an in-memory one. */
export function setBlogImageStoreForTest(s: BlogImageStore | null): void {
  store = s;
}


/** Validate and store one image; returns its id and public address. */
export async function uploadBlogImage(adminId: string, file: Blob) {
  if (file.size === 0) throw new BlogError("The file is empty.");
  if (file.size > BLOG_IMAGE_MAX_BYTES) throw new BlogError("Images must be 4 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new BlogError("Images must be PNG, JPG or WebP.");
  const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${EXT[contentType]}`;
  await blogImageStore().put(path, bytes, contentType);
  const row = await prisma.blogImage.create({ data: { storagePath: path, contentType, sizeBytes: bytes.length, uploadedById: adminId } });
  return { id: row.id, url: blogImageUrl(row.id) };
}

/** The image bytes for the public route, or null. */
export async function readBlogImage(id: string) {
  const row = await prisma.blogImage.findUnique({ where: { id } });
  if (!row) return null;
  const bytes = await blogImageStore().get(row.storagePath);
  return bytes ? { bytes, contentType: row.contentType } : null;
}
