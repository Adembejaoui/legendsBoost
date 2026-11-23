import { Link } from "@/i18n/navigation";
import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { listUsers } from "@/lib/admin/directory";
import { DeletionDecision } from "@/components/admin/Phase9Controls";

export const dynamic = "force-dynamic";

const th = "px-2 py-1.5 text-start text-xs font-medium text-zinc-400";
const td = "px-2 py-1.5 align-top";

/** Admin: all users (search, role filter) and account deletion requests. */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string }> }) {
  const ctx = await getDashboardContext();
  if (!ctx) redirect("/login");
  if (ctx.user.role !== "ADMIN") notFound();
  const { q, role } = await searchParams;
  const [users, requests] = await Promise.all([
    listUsers({ q, role }),
    prisma.accountDeletionRequest.findMany({ where: { status: "REQUESTED" }, orderBy: { requestedAt: "asc" }, take: 50 }),
  ]);
  const requesters = new Map(
    (await prisma.user.findMany({ where: { id: { in: requests.map((r) => r.userId) } }, select: { id: true, name: true, email: true, role: true } })).map((u) => [u.id, u])
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 text-white">
      <h1 className="text-2xl font-semibold">Users</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">Account deletion requests ({requests.length})</h2>
        {requests.length === 0 ? (
          <p className="text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="space-y-2">
            {requests.map((r) => {
              const u = requesters.get(r.userId);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                  <span className="font-medium">{u?.name ?? "User"}</span>
                  <span className="text-zinc-400">{u?.email}</span>
                  <span className="text-xs text-zinc-500">{u?.role?.toLowerCase()} · {r.requestedAt.toISOString().slice(0, 10)}</span>
                  {r.reason ? <span className="text-zinc-300">“{r.reason}”</span> : null}
                  <span className="ms-auto">
                    <DeletionDecision requestId={r.id} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-zinc-500">
          Deleting anonymises the account (name, email, sign-in, booster application, payout details, Riot IDs, logins). Orders and money records are kept without personal data.
        </p>
      </section>

      <form className="flex flex-wrap gap-2" action="/dashboard/admin/users">
        <input name="q" defaultValue={q ?? ""} placeholder="Search name, email or id" className="w-72 rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm" />
        <select name="role" defaultValue={role ?? ""} className="rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm">
          <option value="">All roles</option>
          <option value="CUSTOMER">Customers</option>
          <option value="BOOSTER">Boosters</option>
          <option value="ADMIN">Admins</option>
        </select>
        <button type="submit" className="rounded-md bg-white/10 px-3 py-1.5 text-sm">
          Search
        </button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className={th}>Name</th>
            <th className={th}>Email</th>
            <th className={th}>Role</th>
            <th className={th}>Orders</th>
            <th className={th}>Joined</th>
            <th className={th}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-white/5">
              <td className={td}>{u.deletedAt ? <span className="text-zinc-500">Deleted user</span> : u.name ?? "—"}</td>
              <td className={td}>{u.deletedAt ? "—" : u.email}</td>
              <td className={td}>
                {u.role?.toLowerCase()}
                {u.boosterProfile ? <span className="text-xs text-zinc-500"> · {u.boosterProfile.verificationStatus.toLowerCase()}</span> : null}
              </td>
              <td className={td}>{u._count.orders}</td>
              <td className={td}>{u.createdAt.toISOString().slice(0, 10)}</td>
              <td className={td}>
                {u.boosterProfile ? (
                  <Link href={`/dashboard/admin/boosters/${u.id}`} className="text-violet-300 hover:underline">
                    Booster page
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.length === 100 ? <p className="text-xs text-zinc-500">Showing the latest 100. Search to narrow down.</p> : null}
    </div>
  );
}
