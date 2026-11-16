import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/guards";
import { ConfigError, listConfig, setConfig } from "@/lib/config";

const body = z.object({ key: z.string().min(1).max(80), value: z.unknown() }).strict();

async function admin() {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { user } as const;
}

/** Admin: every setting with its current value and default. */
export async function GET() {
  const a = await admin();
  if (a.error) return a.error;
  return NextResponse.json({ config: await listConfig() });
}

/** Admin: change one setting (validated, audited). `value: null` resets it to the default. */
export async function PUT(req: Request) {
  const a = await admin();
  if (a.error) return a.error;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    await setConfig(a.user.id, parsed.data.key, parsed.data.value ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ConfigError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not save the setting." }, { status: 500 });
  }
}
