// Server-only module.
/**
 * Blog (2026-11-23). Admins write posts in Markdown, one post per language;
 * translations of one article share a `translationGroup`. A post is public
 * once PUBLISHED and its `publishedAt` is reached (a future date schedules
 * it). Public reads are cached and cleared on every change.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidateTag, unstable_cache } from "next/cache";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { routing } from "@/i18n/routing";
import { getGame } from "@/lib/catalog/games";

export const BLOG_CACHE_TAG = "blog";
export const BLOG_PAGE_SIZE = 12;

export class BlogError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "BlogError";
  }
}

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "The address needs at least 3 characters.")
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "The address may only use lower-case letters, numbers and dashes (e.g. lp-gains-explained).");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const blogPostInputSchema = z
  .object({
    locale: z.enum(routing.locales),
    slug,
    title: z.string().trim().min(3, "Add a title.").max(140),
    excerpt: z.string().trim().min(10, "Add a short summary (shown in the list and on Google).").max(300),
    body: z.string().max(100_000),
    coverImageId: z.string().min(1).max(64).optional().nullable(),
    gameSlug: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || !!getGame(v), "Unknown game."),
    tags: z
      .array(z.string().trim().toLowerCase().min(1).max(30).regex(/^[\p{L}\p{N} -]+$/u, "Tags may only use letters, numbers, spaces and dashes."))
      .max(8)
      .default([])
      .transform((t) => [...new Set(t)]),
    status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
    /** ISO date; empty = now when published. A future date schedules the post. */
    publishedAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .nullable()
      .transform((v) => (v ? new Date(v) : null)),
    seoTitle: optionalText(70),
    seoDescription: optionalText(170),
  })
  .strict();
export type BlogPostInput = z.input<typeof blogPostInputSchema>;

function parse(input: unknown) {
  const r = blogPostInputSchema.safeParse(input);
  if (!r.success) throw new BlogError(r.error.issues[0]?.message ?? "Invalid post.");
  return r.data;
}

function clearCache() {
  try {
    revalidateTag(BLOG_CACHE_TAG, { expire: 0 });
  } catch (e) {
    // Outside a request (tests, scripts): the cache expires on its own.
    logger.warn("Blog cache not cleared", { error: e instanceof Error ? e.message : "unknown" });
  }
}

/** Clear messages for the two "already exists" cases (the unique indexes stay the backstop). */
async function assertFree(locale: string, slugValue: string, group: string | null, exceptId?: string) {
  const sameSlug = await prisma.blogPost.findFirst({ where: { locale, slug: slugValue, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (sameSlug) throw new BlogError("Another post in this language already uses this address.", 409);
  if (group) {
    const sameLang = await prisma.blogPost.findFirst({ where: { translationGroup: group, locale, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
    if (sameLang) throw new BlogError("This article already has a version in that language.", 409);
  }
}

async function assertCover(id: string | null | undefined) {
  if (!id) return;
  if (!(await prisma.blogImage.findUnique({ where: { id }, select: { id: true } }))) throw new BlogError("The cover image no longer exists.");
}

function uniqueError(e: unknown): never {
  const target = String((e as { meta?: { target?: unknown } })?.meta?.target ?? "");
  if ((e as { code?: string })?.code === "P2002") {
    if (target.includes("translationGroup")) throw new BlogError("This article already has a version in that language.", 409);
    throw new BlogError("Another post in this language already uses this address.", 409);
  }
  throw e;
}

/** Create a post; `translationOf` links it to an existing article as another language. */
export async function createBlogPost(adminId: string, input: unknown, translationOf?: string) {
  const data = parse(input);
  await assertCover(data.coverImageId);
  let group: string = randomUUID();
  if (translationOf) {
    const source = await prisma.blogPost.findUnique({ where: { id: translationOf }, select: { translationGroup: true } });
    if (!source) throw new BlogError("The original article no longer exists.", 404);
    group = source.translationGroup;
  }
  await assertFree(data.locale, data.slug, translationOf ? group : null);
  const post = await prisma.blogPost
    .create({
      data: {
        ...data,
        translationGroup: group,
        publishedAt: data.status === "PUBLISHED" ? (data.publishedAt ?? new Date()) : data.publishedAt,
        authorId: adminId,
      },
    })
    .catch(uniqueError);
  await audit({ actorId: adminId, action: "blog.create", entityType: "BlogPost", entityId: post.id, metadata: { locale: post.locale, slug: post.slug, status: post.status } });
  clearCache();
  return post;
}

export async function updateBlogPost(adminId: string, id: string, input: unknown) {
  const data = parse(input);
  const current = await prisma.blogPost.findUnique({ where: { id }, select: { id: true, publishedAt: true, translationGroup: true } });
  if (!current) throw new BlogError("Post not found.", 404);
  await assertFree(data.locale, data.slug, current.translationGroup, id);
  await assertCover(data.coverImageId);
  const post = await prisma.blogPost
    .update({
      where: { id },
      data: {
        ...data,
        // Publishing keeps the first publication date unless a new one is given.
        publishedAt: data.status === "PUBLISHED" ? (data.publishedAt ?? current.publishedAt ?? new Date()) : data.publishedAt,
      },
    })
    .catch(uniqueError);
  await audit({ actorId: adminId, action: "blog.update", entityType: "BlogPost", entityId: id, metadata: { status: post.status } });
  clearCache();
  return post;
}

export async function deleteBlogPost(adminId: string, id: string) {
  const post = await prisma.blogPost.delete({ where: { id } }).catch(() => null);
  if (!post) throw new BlogError("Post not found.", 404);
  await audit({ actorId: adminId, action: "blog.delete", entityType: "BlogPost", entityId: id, metadata: { locale: post.locale, slug: post.slug, title: post.title } });
  clearCache();
}

/** Admin list: every post, newest first, with its translations' languages. */
export async function listBlogPostsAdmin() {
  return prisma.blogPost.findMany({
    orderBy: [{ updatedAt: "desc" }],
    select: { id: true, translationGroup: true, locale: true, slug: true, title: true, status: true, publishedAt: true, updatedAt: true, gameSlug: true },
  });
}

export async function getBlogPostAdmin(id: string) {
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) return null;
  const translations = await prisma.blogPost.findMany({
    where: { translationGroup: post.translationGroup, NOT: { id } },
    select: { id: true, locale: true, title: true, status: true },
  });
  return { post, translations };
}

/* Public ------------------------------------------------------------------ */

/** Cached for 5 minutes and cleared on every change; a direct read outside Next.js (tests, scripts). */
function cached<A extends unknown[], R>(fn: (...args: A) => Promise<R>, key: string): (...args: A) => Promise<R> {
  const c = unstable_cache(fn, [key], { tags: [BLOG_CACHE_TAG], revalidate: 300 });
  return async (...args: A) => {
    try {
      return await c(...args);
    } catch (e) {
      if (e instanceof Error && /incrementalCache|static generation store/i.test(e.message)) return fn(...args);
      throw e;
    }
  };
}

const visible = (now: Date) => ({ status: "PUBLISHED" as const, publishedAt: { lte: now } });

export interface BlogListItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImageId: string | null;
  gameSlug: string | null;
  tags: string[];
  publishedAt: string;
  readingMinutes: number;
}

export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220));
}

function toItem(p: { id: string; slug: string; title: string; excerpt: string; coverImageId: string | null; gameSlug: string | null; tags: string[]; publishedAt: Date | null; body: string }): BlogListItem {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    coverImageId: p.coverImageId,
    gameSlug: p.gameSlug,
    tags: p.tags,
    publishedAt: (p.publishedAt ?? new Date(0)).toISOString(),
    readingMinutes: readingMinutes(p.body),
  };
}

async function listPublishedRaw(locale: string, opts: { gameSlug?: string; tag?: string; q?: string; page?: number }) {
  const now = new Date();
  const page = Math.max(1, Math.min(500, Math.floor(opts.page ?? 1)));
  const q = opts.q?.trim().slice(0, 80);
  const where = {
    ...visible(now),
    locale,
    ...(opts.gameSlug ? { gameSlug: opts.gameSlug } : {}),
    ...(opts.tag ? { tags: { has: opts.tag } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" as const } }, { excerpt: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.blogPost.findMany({ where, orderBy: { publishedAt: "desc" }, skip: (page - 1) * BLOG_PAGE_SIZE, take: BLOG_PAGE_SIZE }),
    prisma.blogPost.count({ where }),
  ]);
  return { posts: rows.map(toItem), total, page, pages: Math.max(1, Math.ceil(total / BLOG_PAGE_SIZE)) };
}

/** Published posts of a language (cached; cleared on any change). */
export const listPublishedPosts = cached(listPublishedRaw, "blog:list");

async function getPublishedRaw(locale: string, slugValue: string) {
  const now = new Date();
  const post = await prisma.blogPost.findFirst({
    where: { ...visible(now), locale, slug: slugValue },
    include: { author: { select: { name: true } } },
  });
  if (!post) return null;
  const [translations, related] = await Promise.all([
    prisma.blogPost.findMany({ where: { ...visible(now), translationGroup: post.translationGroup, NOT: { id: post.id } }, select: { locale: true, slug: true } }),
    prisma.blogPost.findMany({
      where: { ...visible(now), locale, NOT: { id: post.id }, ...(post.gameSlug ? { gameSlug: post.gameSlug } : {}) },
      orderBy: { publishedAt: "desc" },
      take: 3,
    }),
  ]);
  return {
    post: { ...toItem(post), body: post.body, seoTitle: post.seoTitle, seoDescription: post.seoDescription, updatedAt: post.updatedAt.toISOString(), authorName: post.author.name },
    translations,
    related: related.map(toItem),
  };
}

/** One published post with its other languages and related posts (cached). */
export const getPublishedPost = cached(getPublishedRaw, "blog:post");

/**
 * The address of the same article in `locale`, when someone opens a post's
 * address in another language (e.g. after switching language). Null if the
 * article has no published version there.
 */
export async function findTranslationSlug(slugValue: string, locale: string): Promise<string | null> {
  const now = new Date();
  const any = await prisma.blogPost.findFirst({ where: { ...visible(now), slug: slugValue }, select: { translationGroup: true } });
  if (!any) return null;
  const t = await prisma.blogPost.findFirst({ where: { ...visible(now), translationGroup: any.translationGroup, locale }, select: { slug: true } });
  return t?.slug ?? null;
}

/** Every published post, for the sitemap. */
export async function sitemapPosts() {
  return prisma.blogPost.findMany({
    where: visible(new Date()),
    select: { locale: true, slug: true, translationGroup: true, updatedAt: true },
  });
}
