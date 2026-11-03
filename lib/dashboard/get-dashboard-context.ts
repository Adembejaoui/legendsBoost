import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import prisma from "@/lib/prisma";
import { UserRole } from "@/lib/auth/permissions";

export type DashboardUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: UserRole;
  createdAt: Date;
};

export type CustomerProfileSelection = {
  id: string;
  phoneNumber: string | null;
  country: string | null;
  preferredLanguage: string | null;
  timezone: string | null;
} | null;

export type BoosterProfileSelection = {
  id: string;
  userId: string;
  verificationStatus: string;
  availabilityStatus: string;
  rejectionReason: string | null;
  welcomeModalSeen: boolean;
  createdAt: Date;
  updatedAt: Date;
} | null;

export type DashboardContext = {
  user: DashboardUser;
  customerProfile: CustomerProfileSelection;
  boosterProfile: BoosterProfileSelection;
};

interface GetDashboardContextOptions {
  includeCustomerProfile?: boolean;
  includeBoosterProfile?: boolean;
}

/**
 * Request-scoped dashboard context.
 *
 * React `cache` deduplicates identical calls within a single render pass.
 * It is scoped to the current request/render: it never caches across users
 * or requests, and it never eliminates round trips caused by redirects.
 *
 * Only the User table and the profile actually required for the caller are
 * fetched. passwordHash is never selected.
 */
export const getDashboardContext = cache(
  async (options: GetDashboardContextOptions = {}): Promise<DashboardContext | null> => {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        createdAt: true,
        ...(options.includeCustomerProfile
          ? {
              customerProfile: {
                select: {
                  id: true,
                  phoneNumber: true,
                  country: true,
                  preferredLanguage: true,
                  timezone: true,
                },
              },
            }
          : {}),
        ...(options.includeBoosterProfile
          ? {
              boosterProfile: {
                select: {
                  id: true,
                  userId: true,
                  verificationStatus: true,
                  availabilityStatus: true,
                  rejectionReason: true,
                  welcomeModalSeen: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
            }
          : {}),
      },
    });

    if (!user) {
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        role: (user.role ?? "CUSTOMER") as UserRole,
        createdAt: user.createdAt,
      },
      customerProfile: options.includeCustomerProfile ? (user.customerProfile ?? null) : null,
      boosterProfile: options.includeBoosterProfile ? (user.boosterProfile ?? null) : null,
    };
  }
);
