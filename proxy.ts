import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intl = createIntlMiddleware(routing);

/** "/fr/dashboard/x" → { prefix: "/fr", path: "/dashboard/x" }; English has no prefix. */
function splitLocale(pathname: string): { prefix: string; path: string } {
  for (const l of routing.locales) {
    if (l === routing.defaultLocale) continue;
    if (pathname === `/${l}` || pathname.startsWith(`/${l}/`)) {
      return { prefix: `/${l}`, path: pathname.slice(l.length + 1) || "/" };
    }
  }
  return { prefix: "", path: pathname };
}

/**
 * 1. Language: English pages keep their address, other languages use a
 *    prefix (/fr/...). A visitor who picked a language (cookie) or whose
 *    browser asks for it is sent to that language's address.
 * 2. Signed-out visitors opening a private page are sent to /login with a
 *    `callbackUrl`, so they come back to the exact page after signing in
 *    (e.g. an order link from an email). Pages still enforce access and
 *    roles themselves; this is only the redirect, never the authorization.
 */
export async function proxy(req: NextRequest) {
  const { prefix, path } = splitLocale(req.nextUrl.pathname);
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    let signedIn = true;
    try {
      signedIn = !!(await getToken({ req, secret: process.env.AUTH_SECRET }));
    } catch {
      // Can't read the session here: let the page decide (it redirects too).
    }
    if (!signedIn) {
      const login = new URL(`${prefix}/login`, req.url);
      login.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return NextResponse.redirect(login);
    }
  }
  return intl(req);
}

export const config = {
  // Every page, not API routes, Next.js internals or files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
