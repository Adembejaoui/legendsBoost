import { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();
        const password = String(credentials.password);

        if (!email || !password) {
          return null;
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
  },
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      // First sign-in for any provider: persist id and fetch authoritative role from DB.
      if (user?.id) {
        token.id = user.id;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, role: true },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role ?? "CUSTOMER";
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
        (session.user as any).id = token.id;
        (session.user as any).role = token.role ?? "CUSTOMER";
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