import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Signed-out visitors opening a private page are sent to /login with a
 * `callbackUrl`, so they come back to the exact page after signing in
 * (e.g. an order link from an email). Pages still enforce access and roles
 * themselves; this is only the redirect, never the authorization.
 */
export async function proxy(req: NextRequest) {
  let signedIn = false;
  try {
    signedIn = !!(await getToken({ req, secret: process.env.AUTH_SECRET }));
  } catch {
    // Can't read the session here: let the page decide (it redirects too).
    return NextResponse.next();
  }
  if (signedIn) return NextResponse.next();

  const login = new URL("/login", req.url);
  login.searchParams.set("callbackUrl", `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
