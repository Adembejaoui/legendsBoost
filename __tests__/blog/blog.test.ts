// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- route/mocks plumbing */
/**
 * Blog (2026-11-23) against an in-memory PostgreSQL with every migration:
 * drafts stay hidden, a future date schedules a post, translations are
 * linked, addresses are unique per language, images are checked and served,
 * and Markdown can never inject HTML, scripts or outside images.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/prisma", async () => ({ default: await (await import("../support/pg-test-db")).getTestPrisma() }));
vi.mock("@/lib/auth/guards", () => ({ getSessionUser: h.getSessionUser }));

import { closeTestDb, getTestPrisma } from "../support/pg-test-db";
import { seedUser } from "../support/payment-fixtures";
import {
  BlogError,
  createBlogPost,
  deleteBlogPost,
  findTranslationSlug,
  getPublishedPost,
  listPublishedPosts,
  readingMinutes,
  updateBlogPost,
} from "@/lib/blog/service";
import { setBlogImageStoreForTest, uploadBlogImage } from "@/lib/blog/images";
import { splitBody, tableOfContents, isAllowedImage } from "@/lib/blog/content";
import { BlogMarkdown } from "@/components/blog/BlogMarkdown";
import { POST as createRoute } from "@/app/api/admin/blog/route";
import { GET as imageRoute } from "@/app/api/blog/images/[imageId]/route";

let prisma: Awaited<ReturnType<typeof getTestPrisma>>;
let admin: { id: string; role: string };
let customer: { id: string; role: string };
let n = 0;

const post = (extra: Record<string, unknown> = {}) => ({
  locale: "en",
  slug: `lp-gains-explained-${++n}`,
  title: "LP gains explained",
  excerpt: "Why you only gain 15 LP per win, and how to fix it.",
  body: "## Why it happens\n\nText.\n\n## How to fix it\n\nMore text.",
  tags: ["Ranked", "LP", "ranked"],
  ...extra,
});

const files = new Map<string, Uint8Array>();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  prisma = await getTestPrisma();
  admin = (await seedUser("ADMIN")) as any;
  customer = (await seedUser("CUSTOMER")) as any;
  setBlogImageStoreForTest({ put: async (p, b) => void files.set(p, b), get: async (p) => files.get(p) ?? null });
}, 60_000);
afterAll(async () => {
  setBlogImageStoreForTest(null);
  await closeTestDb();
});
beforeEach(() => h.getSessionUser.mockResolvedValue({ ...admin, role: "ADMIN" }));

describe("publishing", () => {
  it("a draft is hidden; publishing shows it with a date; tags are cleaned", async () => {
    const draft = await createBlogPost(admin.id, post());
    expect(draft.status).toBe("DRAFT");
    expect(draft.tags).toEqual(["ranked", "lp"]);
    expect(await getPublishedPost("en", draft.slug)).toBeNull();

    const published = await updateBlogPost(admin.id, draft.id, { ...post({ slug: draft.slug }), status: "PUBLISHED" });
    expect(published.publishedAt).toBeInstanceOf(Date);
    const shown = await getPublishedPost("en", draft.slug);
    expect(shown?.post).toMatchObject({ title: "LP gains explained", readingMinutes: 1 });
    expect((await listPublishedPosts("en", { tag: "lp" })).posts.map((p) => p.slug)).toContain(draft.slug);
  });

  it("a future date schedules the post: hidden until then", async () => {
    const future = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    const p = await createBlogPost(admin.id, { ...post(), status: "PUBLISHED", publishedAt: future });
    expect(await getPublishedPost("en", p.slug)).toBeNull();
  });

  it("search, game filter and pages", async () => {
    await createBlogPost(admin.id, { ...post({ title: "Best Valorant agents for ranked" }), gameSlug: "valorant", status: "PUBLISHED" });
    const byGame = await listPublishedPosts("en", { gameSlug: "valorant" });
    expect(byGame.posts.every((p) => p.gameSlug === "valorant")).toBe(true);
    expect((await listPublishedPosts("en", { q: "valorant AGENTS" })).posts).toHaveLength(1);
  });

  it("refuses bad input with a clear message", async () => {
    await expect(createBlogPost(admin.id, post({ slug: "Not A Slug!" }))).rejects.toThrow(/lower-case letters/);
    await expect(createBlogPost(admin.id, post({ gameSlug: "chess" }))).rejects.toThrow("Unknown game.");
    await expect(createBlogPost(admin.id, { ...post(), price: 1 })).rejects.toBeInstanceOf(BlogError);
  });
});

describe("languages", () => {
  it("translations are linked; one version per language; addresses unique per language", async () => {
    const en = await createBlogPost(admin.id, { ...post({ slug: "season-reset-guide" }), status: "PUBLISHED" });
    const fr = await createBlogPost(admin.id, { ...post({ locale: "fr", slug: "guide-reinitialisation-saison", title: "Guide de la réinitialisation" }), status: "PUBLISHED" }, en.id);
    expect(fr.translationGroup).toBe(en.translationGroup);

    const shown = await getPublishedPost("en", "season-reset-guide");
    expect(shown?.translations).toEqual([{ locale: "fr", slug: "guide-reinitialisation-saison" }]);
    // Switching language on the English address finds the French one.
    expect(await findTranslationSlug("season-reset-guide", "fr")).toBe("guide-reinitialisation-saison");

    await expect(createBlogPost(admin.id, post({ locale: "fr", slug: "autre" }), en.id)).rejects.toMatchObject({ status: 409 });
    await expect(createBlogPost(admin.id, post({ slug: "season-reset-guide" }))).rejects.toThrow(/already uses this address/);
    // The same address is fine in another language.
    await expect(createBlogPost(admin.id, post({ locale: "fr", slug: "season-reset-guide" }))).resolves.toBeTruthy();
  });

  it("deleting one language keeps the others", async () => {
    const en = await createBlogPost(admin.id, { ...post(), status: "PUBLISHED" });
    const fr = await createBlogPost(admin.id, { ...post({ locale: "fr" }), status: "PUBLISHED" }, en.id);
    await deleteBlogPost(admin.id, fr.id);
    expect(await prisma.blogPost.findUnique({ where: { id: en.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "blog.delete", entityId: fr.id } })).toBe(1);
  });
});

describe("admin only", () => {
  it("customers cannot create posts", async () => {
    h.getSessionUser.mockResolvedValue({ ...customer, role: "CUSTOMER" });
    const res = await createRoute(new Request("http://t/api/admin/blog", { method: "POST", body: JSON.stringify(post()) }));
    expect(res.status).toBe(403);
  });
});

describe("images", () => {
  it("only real PNG / JPG / WebP files; served publicly with a long cache", async () => {
    await expect(uploadBlogImage(admin.id, new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(/PNG, JPG or WebP/);
    const img = await uploadBlogImage(admin.id, new Blob([PNG]));
    expect(img.url).toBe(`/api/blog/images/${img.id}`);
    const res = await imageRoute(new Request("http://t"), { params: Promise.resolve({ imageId: img.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect((await imageRoute(new Request("http://t"), { params: Promise.resolve({ imageId: "../etc" }) })).status).toBe(404);
  });

  it("a cover must be an uploaded image", async () => {
    await expect(createBlogPost(admin.id, { ...post(), coverImageId: "missing-image-id" })).rejects.toThrow(/cover image/);
  });
});

describe("content", () => {
  it("order boxes are lines with only [service:game/service]; unknown ones stay text; code blocks untouched", () => {
    const blocks = splitBody("Intro\n\n[service:league-of-legends/rank-boost]\n\n[service:chess/rank-boost]\n\n```\n[service:league-of-legends/win-boost]\n```");
    expect(blocks.map((b) => b.type)).toEqual(["markdown", "service", "markdown"]);
    expect(blocks[1]).toEqual({ type: "service", gameSlug: "league-of-legends", serviceSlug: "rank-boost" });
  });

  it("table of contents from ## headings; reading time ~220 words a minute", () => {
    expect(tableOfContents("## Été & LP gains!\ntext\n### sub\n## Second")).toEqual([
      { id: "ete-lp-gains", text: "Été & LP gains!" },
      { id: "second", text: "Second" },
    ]);
    expect(readingMinutes("word ".repeat(1100))).toBe(5);
  });

  it("Markdown never renders HTML, scripts, javascript: links or outside images", () => {
    const html = renderToStaticMarkup(
      createElement(BlogMarkdown, {
        text: [
          "<script>alert(1)</script>",
          '<img src="x" onerror="alert(1)">',
          "[bad](javascript:alert(1)) [out](https://example.com) [in](/games)",
          "![tracker](https://evil.test/p.png) ![ok](/api/blog/images/abcdefghij12)",
        ].join("\n\n"),
      })
    );
    // Raw HTML is shown as plain (escaped) text, never as tags.
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil.test");
    expect(html).toMatch(/<a href="https:\/\/example\.com"[^>]*target="_blank" rel="nofollow noopener noreferrer"/);
    expect(html).toContain('href="/games"');
    expect(html).toContain('src="/api/blog/images/abcdefghij12"');
    expect(isAllowedImage("/api/blog/images/../x")).toBe(false);
  });
});
