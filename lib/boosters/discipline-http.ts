import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { DisciplineError } from "./discipline";

export async function requireRoleUser(role: "ADMIN" | "BOOSTER") {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (user.role !== role) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { user } as const;
}

export function disciplineError(e: unknown) {
  if (e instanceof DisciplineError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
