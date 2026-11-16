// Server-only module: never import from a "use client" file.
import prisma from "@/lib/prisma";
import { getRiotApiKey, getRiotRateLimits } from "./capabilities";
import { createDbRiotLimiter } from "./rate-limiter";
import { createRiotClient, type RiotClient } from "./riot-client";

let shared: RiotClient | null = null;

/**
 * Process-wide Riot client. Its limiter keeps counters and Retry-After
 * cooldowns in Postgres so every serverless instance shares Riot's per-key,
 * per-region limits.
 */
export function getRiotClient(): RiotClient {
  shared ??= createRiotClient({
    limiter: createDbRiotLimiter({
      db: prisma,
      apiKey: () => getRiotApiKey(),
      limits: () => getRiotRateLimits(),
    }),
  });
  return shared;
}
