import { redirect } from "next/navigation";
import { getDashboardContext } from "@/lib/dashboard/get-dashboard-context";
import { devLogRedirect } from "@/lib/dashboard/role-routing";
import ProfileClient from "./ProfileClient";
import { DeleteAccountCard } from "@/components/account/DeleteAccountCard";
import { ChangePasswordCard } from "@/components/account/ChangePasswordCard";
import prisma from "@/lib/prisma";
import { BoosterSelfService, type SelfPermission } from "@/components/booster/BoosterSelfService";
import { BOOSTER_STATUS_LABEL, type BoosterStatus } from "@/lib/boosters/status";
import { rankScale } from "@/lib/domain/rank";
import { getRankSystem } from "@/lib/catalog/rank-systems";
import { getGame } from "@/lib/catalog/games";

function rankLabel(rankSystemId: string, tierId: string, divisionId: string | null) {
  const tier = getRankSystem(rankSystemId)?.tiers.find((t) => t.id === tierId);
  const div = tier?.divisions?.find((d) => d.id === divisionId);
  return `${tier?.name ?? tierId}${div ? ` ${div.label}` : ""}`;
}

export default async function ProfilePage() {
  const ctx = await getDashboardContext({ includeBoosterProfile: true });
  if (!ctx) {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/login",
      databaseRole: null,
      boosterStatus: null,
      reason: "Unauthenticated: no session",
    });
    redirect("/login");
  }
  const user = ctx.user;
  const boosterStatus = ctx.boosterProfile?.verificationStatus ?? null;

  if (user.role === "CUSTOMER") {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/dashboard/customer",
      databaseRole: user.role,
      boosterStatus,
      reason: "CUSTOMER must use the customer dashboard",
    });
    redirect("/dashboard/customer");
  }
  if (user.role === "ADMIN") {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/dashboard/admin",
      databaseRole: user.role,
      boosterStatus,
      reason: "ADMIN must use the admin dashboard",
    });
    redirect("/dashboard/admin");
  }
  if (user.role !== "BOOSTER") {
    devLogRedirect({
      from: "/dashboard/booster/profile",
      to: "/login",
      databaseRole: user.role,
      boosterStatus,
      reason: "Unauthorized role for booster profile",
    });
    redirect("/login");
  }

  const rows = ctx.boosterProfile
    ? await prisma.boosterPermission.findMany({ where: { boosterProfileId: ctx.boosterProfile.id }, orderBy: { gameSlug: "asc" } })
    : [];
  const permissions: SelfPermission[] = rows.map((p) => ({
    gameSlug: p.gameSlug,
    gameName: getGame(p.gameSlug)?.name ?? p.gameSlug,
    ceilingLabel: rankLabel(p.rankSystemId, p.maxTargetTierId, p.maxTargetDivisionId),
    lowerOptions: rankScale(p.rankSystemId)
      .filter((r) => r.value < p.maxTargetRankValue)
      .reverse()
      .map((r) => ({ tierId: r.tierId, divisionId: r.divisionId, label: rankLabel(p.rankSystemId, r.tierId, r.divisionId) })),
    regions: p.regions,
    services: p.serviceSlugs,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your booster profile and availability
        </p>
      </div>
      {ctx.boosterProfile ? (
        <BoosterSelfService
          status={ctx.boosterProfile.verificationStatus}
          statusLabel={BOOSTER_STATUS_LABEL[ctx.boosterProfile.verificationStatus as BoosterStatus] ?? ctx.boosterProfile.verificationStatus}
          trialOrdersRemaining={ctx.boosterProfile.trialOrdersRemaining}
          kycStatus={ctx.boosterProfile.kycStatus}
          displayName={ctx.boosterProfile.displayName}
          permissions={permissions}
        />
      ) : null}
      <ProfileClient user={user} boosterProfile={ctx.boosterProfile} />
      <div className="mt-6">
        <ChangePasswordCard />
      <DeleteAccountCard />
      </div>
    </div>
  );
}
