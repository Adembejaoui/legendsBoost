import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * Reject an assignment id that does not belong to the order in the URL
 * BEFORE any state change happens. (Previously routes compared after the
 * mutation had already been committed.)
 */
export async function rejectIfAssignmentNotInOrder(
  assignmentId: string,
  orderId: string
): Promise<NextResponse | null> {
  const assignment = await prisma.orderBoosterAssignment.findUnique({
    where: { id: assignmentId },
    select: { orderId: true },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }
  if (assignment.orderId !== orderId) {
    return NextResponse.json({ error: "Assignment does not belong to this order" }, { status: 403 });
  }
  return null;
}
