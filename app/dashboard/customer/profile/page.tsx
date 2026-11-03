import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect, getRoleHomePath } from "@/lib/dashboard/role-routing";
import prisma from "@/lib/prisma";
import { PersonalInformationForm } from "@/components/dashboard/profile/PersonalInformationForm";
import { AccountInformationCard } from "@/components/dashboard/profile/AccountInformationCard";

export default async function CustomerProfilePage() {
  const ctx = await getDashboardContext({ includeCustomerProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/customer/profile",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/customer/profile",
      to: "/dashboard/booster",
      databaseRole: user.role,
      boosterStatus,
      reason: "BOOSTER must use the booster dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/customer/profile",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect(getRoleHomePath(user.role));
  }
  if (user.role !== "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/customer/profile",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for customer profile",
    });
    redirect("/login");
  }

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });

  const initial = {
    name: user.name ?? "",
    email: user.email ?? "",
    phoneNumber: ctx.customerProfile?.phoneNumber ?? "",
    country: ctx.customerProfile?.country ?? "",
    role: user.role,
    createdAt: user.createdAt,
    providers: accounts.map((a) => a.provider),
    hasPassword: accounts.some((a) => a.provider === "credentials"),
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-violet-400">Account Settings</p>
        <h1 className="mt-2 text-2xl font-bold text-white">My Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">Manage your personal information and account details.</p>
      </div>
      <PersonalInformationForm initial={initial} />
      <AccountInformationCard
        role={initial.role}
        createdAt={initial.createdAt}
        providers={initial.providers}
        hasPassword={initial.hasPassword}
      />
    </div>
  );
}
