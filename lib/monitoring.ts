/**
 * Sentry data-collection policy, shared by server and browser init.
 *
 * Sentry v11 collects user info, cookies, headers, request/response bodies,
 * query strings and database query data by default. Here bodies can contain
 * passwords and game-account logins, cookies hold the session, and query
 * strings can hold Stripe session ids: collect NONE of it. Errors, stack
 * traces and the route are enough to debug.
 */
import type * as Sentry from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]>;

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
};
