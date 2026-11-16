import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { JOBS, runJob } from "@/lib/jobs";

/**
 * Scheduled job trigger (Vercel Cron, see vercel.json).
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel sends it automatically
 * when CRON_SECRET is set). Without CRON_SECRET configured, every call is
 * refused. Jobs are idempotent and leased, so retries and overlaps are safe.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { job } = await params;
  if (!(job in JOBS)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  const result = await runJob(job);
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
