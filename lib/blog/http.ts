import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { BlogError } from "./service";

/** Blog errors become their status and message; anything else is a 500. */
export function blogErrorResponse(e: unknown) {
  if (e instanceof BlogError) return NextResponse.json({ error: e.message }, { status: e.status });
  logger.error("Blog request failed", { error: e instanceof Error ? e.name : "unknown" });
  return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
}
