import "next-auth";
import "next-auth/jwt";
import { DefaultSession } from "next-auth";
import { UserRole } from "@/lib/auth/permissions";

export type { UserRole };

declare module "next-auth" {
  interface User {
    id?: string;
    role?: UserRole;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
  }
}
