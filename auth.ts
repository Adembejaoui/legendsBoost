import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { clientIp, LIMITS, sharedRateLimit } from "@/lib/security/shared-rate-limit";

/** Thrown from authorize(); next-auth returns its message as `error`. */
export const LOGIN_RATE_LIMITED = "RATE_LIMITED";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();
        const password = String(credentials.password);

        if (!email || !password) {
          return null;
        }

        // Brute-force protection shared by every server instance: per account
        // and per IP. Checked BEFORE the password so a locked-out attacker
        // learns nothing (and costs no bcrypt work).
        const ip = clientIp(req?.headers as Record<string, string> | undefined);
        const [byEmail, byIp] = await Promise.all([
          sharedRateLimit("login-email", email, LIMITS.loginPerEmail),
          sharedRateLimit("login-ip", ip, LIMITS.loginPerIp),
        ]);
        if (!byEmail.success || !byIp.success) {
          throw new Error(LOGIN_RATE_LIMITED);
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          // Generic error to avoid account enumeration.
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // Decision 2026-11-15: stay signed in for 30 days.
    maxAge: 30 * 24 * 60 * 60,
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  events: {
    // First Google sign-in (the account row is created after the signIn
    // callback ran): mark the email as confirmed.
    async linkAccount({ user, account }) {
      if (account.provider !== "google" || !user?.id) return;
      await prisma.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } }).catch(() => {});
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in for any provider: persist id and fetch authoritative role from DB.
      if (user?.id) {
        token.id = user.id;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, role: true, sessionVersion: true },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role ?? "CUSTOMER";
            token.sv = dbUser.sessionVersion;
          }
        } catch (err) {
          logger.error("Failed to fetch user role for JWT", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        token.role = token.role ?? "CUSTOMER";
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        const u = session.user as { id?: unknown; role?: unknown; sv?: unknown };
        u.id = token.id;
        u.role = token.role ?? "CUSTOMER";
        u.sv = typeof token.sv === "number" ? token.sv : 0;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Google-only sign-in: ensure a CustomerProfile exists for new CUSTOMER users.
      if (account?.provider === "google" && user?.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            include: { customerProfile: true },
          });

          // Google has already confirmed the address.
          if (dbUser && !dbUser.emailVerified && !dbUser.deletedAt) {
            await prisma.user.update({ where: { id: dbUser.id }, data: { emailVerified: new Date() } });
          }
          if (dbUser && dbUser.role === "CUSTOMER" && !dbUser.customerProfile) {
            await prisma.customerProfile.create({
              data: { userId: dbUser.id },
            });
          }
        } catch (err) {
          logger.error("Failed to create customer profile on Google sign-in", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return true;
    },
  },
};

export default authOptions;