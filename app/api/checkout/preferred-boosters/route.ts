import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { listPreferableBoosters } from "@/lib/pool/preferred";

const bodySchema = z
  .object({
    gameSlug: z.string().min(1).max(64),
    serviceSlug: z.string().min(1).max(64),
    configuration: z.record(z.string().max(64), z.unknown()).default({}),
  })
  .strict();

/** Boosters the signed-in customer may choose for this order (display names only). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ boosters: [] });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  return NextResponse.json({ boosters: await listPreferableBoosters(parsed.data) });
}
