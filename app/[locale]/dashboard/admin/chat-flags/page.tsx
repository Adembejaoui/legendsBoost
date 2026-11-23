import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { MarkFlagReviewed } from "./MarkFlagReviewed";

export const dynamic = "force-dynamic";

/**
 * Admin: chat messages where contact or payment details were hidden. The
 * original text is shown here only (customers and boosters saw "[hidden]").
 */
export default async function AdminChatFlagsPage() {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();

  const flags = await prisma.chatModerationFlag.findMany({
    where: { reviewedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const senderIds = [...new Set(flags.map((f) => f.senderId).filter((id): id is string => !!id))];
  const senders = await prisma.user.findMany({ where: { id: { in: senderIds } }, select: { id: true, name: true, role: true } });
  const senderBy = new Map(senders.map((s) => [s.id, s]));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-white">
      <div>
        <h1 className="text-2xl font-semibold">Chat flags</h1>
        <p className="text-sm text-zinc-400">
          Messages with contact or payment details. The details were hidden for the other party; the original is shown here.
        </p>
      </div>
      {flags.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 p-8 text-center text-sm text-zinc-400">Nothing to review.</p>
      ) : (
        <ul className="space-y-3">
          {flags.map((f) => {
            const sender = f.senderId ? senderBy.get(f.senderId) : null;
            return (
              <li key={f.id} className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <span>{f.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                  <span>·</span>
                  <span>
                    {sender?.name ?? "Unknown"} ({sender?.role?.toLowerCase() ?? "?"})
                  </span>
                  <span>·</span>
                  <Link href={`/dashboard/${f.orderId}`} className="text-violet-300 hover:underline">
                    Order #{f.orderId.slice(-8).toUpperCase()}
                  </Link>
                  {f.kinds.map((k) => (
                    <span key={k} className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">
                      {k.toLowerCase()}
                    </span>
                  ))}
                </div>
                <p className="whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 text-sm text-zinc-200">{f.original}</p>
                <MarkFlagReviewed flagId={f.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
