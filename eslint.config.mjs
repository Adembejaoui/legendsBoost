import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // LEGACY DEBT (lint baseline 2026-11-14, build plan Phase 0.B):
  // these files predate the lint rules below. The rules are WARNINGS only
  // for them, so `npm run lint` passes; every other (new) file keeps them as
  // errors. Shrink these lists when you touch a file: remove the `any` /
  // the setState-in-effect, then remove the file from the list.
  {
    files: [
      "__tests__/assignments.service.test.ts",
      "__tests__/assignments/reassignment-revocation.test.ts",
      "__tests__/realtime/authorization.test.ts",
      "__tests__/riot/routing.test.ts",
      "__tests__/security/sanitize.test.ts",
      "__tests__/support/ticket-transitions.test.ts",
      "app/api/booster/profile/route.ts",
      "app/api/orders/[[]orderId]/messages/route.ts",
      "app/api/support/tickets/[[]ticketId]/messages/route.ts",
      "app/api/support/tickets/[[]ticketId]/route.ts",
      "app/[[]locale]/dashboard/booster/available-orders/page.tsx",
      "app/[[]locale]/dashboard/booster/claimed-orders/page.tsx",
      "app/[[]locale]/dashboard/booster/page.tsx",
      "app/[[]locale]/dashboard/booster/profile/ProfileClient.tsx",
      "app/[[]locale]/dashboard/support/new/page.tsx",
      "app/[[]locale]/games/[[]gameSlug]/services/[[]serviceSlug]/page.tsx",
      "components/checkout/CheckoutOptionRow.tsx",
      "components/service-configurator/CheckoutPanel.tsx",
      "components/service-configurator/ServiceConfiguratorNew.tsx",
      "components/service-configurator/ServicePageHeader.tsx",
      "components/support/SupportTicketDetail.tsx",
      "components/ui/button.tsx",
      "lib/assignments/service.ts",
      "lib/chat/service.ts",
      "lib/dashboard/navigation.ts",
      "lib/notifications/service.ts",
      "lib/notifications/types.ts",
      "lib/orders/draft-store.ts",
      "lib/support/service.ts",
      "scripts/add-check-constraint.ts"
    ],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
  {
    files: [
      "app/[[]locale]/dashboard/booster/available-orders/AvailableOrdersClient.tsx",
      "components/checkout/ChampionsRolesModal.tsx",
      "components/configurator/RankPicker.tsx",
      "components/notifications/NotificationBell.tsx",
      "components/notifications/NotificationCenter.tsx",
      "components/support/SupportTicketDetail.tsx",
      "components/support/SupportTicketList.tsx"
    ],
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Untracked, vendored copy of the next@16.4.3 npm package (not app code;
    // also excluded in tsconfig.json). See docs/TYPESCRIPT-BUILD-REMEDIATION.md.
    "package/**",
    // Unreferenced local helper script (untracked); not app code.
    "als-setup.cjs",
  ]),
]);

export default eslintConfig;
