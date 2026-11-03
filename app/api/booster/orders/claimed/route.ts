import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { getBoosterAssignments } from "@/lib/assignments/service";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "BOOSTER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const assignments = await getBoosterAssignments(user.id, "all");

    return NextResponse.json({ assignments });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Booster")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to fetch claimed orders" },
      { status: 500 }
    );
  }
}
