import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import prisma from "@/lib/prisma";
import { UserRole } from "@/types/next-auth";

export async function getCurrentUser() {
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
    },
  });

  if (!user) {
    return null;
  }

  return {
    ...user,
    role: (user.role ?? "CUSTOMER") as UserRole,
  };
}

export async function getCurrentUserWithProfiles() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      customerProfile: true,
      boosterProfile: true,
    },
  });

  if (!user) {
    return null;
  }

  return {
    ...user,
    role: (user.role ?? "CUSTOMER") as UserRole,
  };
}
