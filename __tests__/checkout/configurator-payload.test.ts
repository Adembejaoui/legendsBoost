/* eslint-disable @typescript-eslint/no-explicit-any -- DOM plumbing */
/**
 * Step 3 -> step 4 of the four-step checkout, driven through the REAL UI
 * (ServiceConfiguratorNew + CheckoutPanel) like a customer, for every
 * catalog service. The browser requests are checked against the server's
 * own schema, validator and eligibility rule. Network is a fake `fetch`;
 * the Stripe redirect is observed through redirectToStripeCheckout.
 *
 * Covers: live quote, single "Continue to Payment" (quote -> order ->
 * Stripe session -> redirect, no review page), duplicate-click protection,
 * checkout-failure recovery without a duplicate order, back navigation
 * (selections restored), sign-in required, price change (409), and
 * unavailable services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ push: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("next/image", () => ({ default: (p: any) => React.createElement("img", { src: p.src, alt: p.alt }) }));
vi.mock("next/link", () => ({ default: (p: any) => React.createElement("a", { href: p.href, className: p.className }, p.children) }));
vi.mock("@/lib/checkout/redirect", () => ({ redirectToStripeCheckout: h.redirect }));

import { ServiceConfiguratorNew } from "@/components/service-configurator/ServiceConfiguratorNew";
import { gameServices } from "@/lib/catalog/game-services";
import { getCheckoutConfig } from "@/lib/config/checkout-options";
import { getRankSystemsByGame } from "@/lib/catalog/rank-systems";
import { getChampions } from "@/lib/catalog/champions";
import { getGame } from "@/lib/catalog/games";
import { orderRequestSchema, validateOrderInput } from "@/lib/pricing/order-input";
import { evaluateOrderEligibility } from "@/lib/orders/order-eligibility";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  h.push.mockReset();
  h.redirect.mockReset();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, what: string, timeout = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for: ${what}`);
    await act(async () => {
      await sleep(25);
    });
  }
}
const click = async (el: Element | null | undefined, what: string) => {
  if (!el) throw new Error(`not found: ${what}`);
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const buttonByText = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
/** The pay button. Ticks the required risk notice first, as a customer must. */
const cta = () => {
  const risk = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (risk && !risk.checked) act(() => risk.click());
  return buttonByText(container, "Continue to Payment") as HTMLButtonElement | undefined;
};
const rankCard = (heading: string) => [...container.querySelectorAll("h3")].find((x) => x.textContent === heading)?.closest(".rounded-xl");

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
type Responder = (call: Call, n: number) => Response | undefined | Promise<Response | undefined>;

/** Fake backend: quote -> 1000 USD, order -> 201 order_1, checkout -> Stripe URL. Override per test. */
function stubBackend(override?: Responder) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any = {}) => {
      const call: Call = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers ?? {} };
      calls.push(call);
      const custom = await override?.(call, calls.filter((c) => c.url === url).length);
      if (custom) return custom;
      if (url === "/api/orders/quote")
        return Response.json({ quote: { currency: "USD", totalAmount: 1000, lines: [{ code: "BASE", label: "Base price", amount: 1000 }] } });
      if (url === "/api/orders") return Response.json({ order: { id: "order_1", status: "AWAITING_PAYMENT", paid: false } }, { status: 201 });
      if (url === "/api/orders/order_1/checkout") return Response.json({ url: "https://checkout.stripe.test/c/pay/cs_test_1" });
      return Response.json({ error: "unexpected" }, { status: 500 });
    })
  );
  return calls;
}

async function renderService(offer: (typeof gameServices)[number], purchase = { orderable: true, testMode: true, reason: null as string | null }) {
  const game = getGame(offer.gameSlug)!;
  await act(async () => {
    root.render(
      React.createElement(ServiceConfiguratorNew, {
        game: { slug: game.slug, name: game.name, accent: game.accent },
        offer: { ...offer, purchase } as any,
        template: { slug: offer.serviceSlug, title: offer.title, description: "", category: "" },
        rankSystems: getRankSystemsByGame(offer.gameSlug),
        champions: getChampions(),
      })
    );
  });
}

/** Fill every required field through the UI, like a customer. */
async function fillRequired(offer: (typeof gameServices)[number]) {
  const paired = offer.fields.filter((f) => f.type === "rank-picker").length >= 2;
  for (const f of offer.fields as any[]) {
    if (!f.required) continue;
    if (f.type === "rank-picker") {
      const heading = paired ? (f.key === "targetRank" ? "Desired Rank" : "Current Rank") : f.label;
      const system = getRankSystemsByGame(offer.gameSlug).find((s) => s.id === f.rankSystemId)!;
      const tier = system.tiers[f.key === "targetRank" ? 1 : 0];
      await click(rankCard(heading)?.querySelector(`button[aria-label="${tier.name}"]`), `${f.key} tier`);
      if (tier.divisions?.length) await click(buttonByText(rankCard(heading)!, tier.divisions[0].label), `${f.key} division`);
    } else if (f.type === "champion-picker") {
      await click(container.querySelector(`[role="group"][aria-label="${f.label}"] button`), "champion");
    }
  }
}

const quoteCalls = (calls: Call[]) => calls.filter((c) => c.url === "/api/orders/quote");
const orderCalls = (calls: Call[]) => calls.filter((c) => c.url === "/api/orders");
const checkoutCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/checkout"));

describe.each(gameServices.map((o) => [`${o.gameSlug}:${o.serviceSlug}`, o] as const))("%s", (_key, offer) => {
  it("configure -> live quote -> Continue to Payment -> order -> Stripe Checkout redirect (no review page)", async () => {
    const checkout = getCheckoutConfig(offer.gameSlug, offer.serviceSlug)!;
    const calls = stubBackend();
    await renderService(offer);
    // Disabled until every required field without a default is filled.
    const needsInput = offer.fields.some((f: any) => f.required && f.defaultValue === undefined);
    expect(cta()?.disabled).toBe(needsInput);
    await fillRequired(offer);

    // Live price from the server quote API, shown with its breakdown.
    await waitFor(() => container.textContent!.includes("$10.00") && !container.textContent!.includes("Calculating your price"), "live quote");
    expect(container.textContent).toContain("Base price");
    expect(container.textContent).not.toContain("Missing required field");
    const quoteBody = quoteCalls(calls).at(-1)!.body;
    const parsed = orderRequestSchema.safeParse(quoteBody);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(evaluateOrderEligibility(offer, checkout, "test").ok).toBe(true);
    const validated = validateOrderInput(offer, checkout, parsed.data!);
    expect(validated.ok, JSON.stringify(validated)).toBe(true);

    // One click: order (idempotent) -> Stripe session -> redirect. Nothing in between.
    const quotesBefore = quoteCalls(calls).length;
    await click(cta(), "Continue to Payment");
    await waitFor(() => h.redirect.mock.calls.length === 1, "Stripe redirect");
    expect(quoteCalls(calls).length).toBe(quotesBefore); // the fresh live quote was reused
    const [order] = orderCalls(calls);
    expect(order.method).toBe("POST");
    expect(order.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    const { expectedTotal, riskAccepted, ...orderRequest } = order.body;
    expect(expectedTotal).toEqual({ amount: 1000, currency: "USD" });
    expect(riskAccepted).toBe(true); // the customer ticked the risk notice
    expect(orderRequest).toEqual(quoteBody); // exactly the quoted configuration
    expect(orderRequestSchema.safeParse(order.body).success).toBe(true);
    expect(checkoutCalls(calls).map((c) => [c.url, c.method])).toEqual([["/api/orders/order_1/checkout", "POST"]]);
    expect(h.redirect).toHaveBeenCalledWith("https://checkout.stripe.test/c/pay/cs_test_1");
    expect(h.push).not.toHaveBeenCalled(); // no /checkout/review or /checkout/payment page
    expect(container.textContent).toContain("Redirecting to Stripe");
  });
});

describe("checkout safety and recovery (LoL rank boost)", () => {
  const offer = gameServices.find((o) => o.gameSlug === "league-of-legends" && o.serviceSlug === "rank-boost")!;
  const ready = async () => {
    await renderService(offer);
    await fillRequired(offer);
    await waitFor(() => container.textContent!.includes("$10.00"), "live quote");
  };

  it("a double click creates one order and one Stripe session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const calls = stubBackend(async (c) => {
      if (c.url === "/api/orders") {
        await gate;
        return Response.json({ order: { id: "order_1", status: "AWAITING_PAYMENT", paid: false } }, { status: 201 });
      }
    });
    await ready();
    const button = cta()!;
    await act(async () => {
      button.click();
      button.click();
      button.click();
    });
    release();
    await waitFor(() => h.redirect.mock.calls.length === 1, "redirect");
    expect(orderCalls(calls)).toHaveLength(1);
    expect(checkoutCalls(calls)).toHaveLength(1);
  });

  it("Stripe session failure keeps the unpaid order; retry reuses the same Idempotency-Key (no duplicate order)", async () => {
    const calls = stubBackend((c, n) => {
      if (c.url === "/api/orders/order_1/checkout" && n === 1) return Response.json({ error: "Could not start the payment. Please try again." }, { status: 502 });
      if (c.url === "/api/orders" && orderCalls(calls).length > 1) return Response.json({ order: { id: "order_1", status: "AWAITING_PAYMENT", paid: false } }, { status: 200 }); // replay
    });
    await ready();
    await click(cta(), "Continue to Payment");
    await waitFor(() => container.querySelector('[role="alert"]') !== null, "error message");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Nothing was charged");
    expect(h.redirect).not.toHaveBeenCalled();
    expect(cta()!.disabled).toBe(false);

    await click(cta(), "Continue to Payment (retry)");
    await waitFor(() => h.redirect.mock.calls.length === 1, "redirect after retry");
    const [first, second] = orderCalls(calls);
    expect(second.headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    expect(second.body).toEqual(first.body);
    expect(checkoutCalls(calls).map((c) => c.url)).toEqual(["/api/orders/order_1/checkout", "/api/orders/order_1/checkout"]);
  });

  it("going back restores the configuration; returning from Stripe replays the same order", async () => {
    const calls = stubBackend();
    await ready();
    await click(cta(), "Continue to Payment");
    await waitFor(() => h.redirect.mock.calls.length === 1, "redirect");

    // Customer comes back (browser back / Stripe back link / step indicator): fresh mount.
    act(() => root.unmount());
    root = createRoot(container);
    await renderService(offer);
    await waitFor(() => container.textContent!.includes("Iron IV") && container.textContent!.includes("$10.00"), "restored selections + quote");
    await click(cta(), "Continue to Payment again");
    await waitFor(() => h.redirect.mock.calls.length === 2, "second redirect");
    const [a, b] = orderCalls(calls);
    expect(b.headers["Idempotency-Key"]).toBe(a.headers["Idempotency-Key"]); // same order, not a duplicate
  });

  it("signed-out customers are sent to sign in and come back to this page", async () => {
    stubBackend((c) => (c.url === "/api/orders/quote" ? Response.json({ error: "Unauthorized" }, { status: 401 }) : undefined));
    await ready().catch(() => undefined); // no price is shown when signed out
    await waitFor(() => container.textContent!.includes("Sign in to continue"), "sign-in prompt");
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Sign in to continue")!;
    expect(link.getAttribute("href")).toMatch(/^\/login\?callbackUrl=%2F/);
  });

  it("a price change (409) shows the new price instead of charging the old one", async () => {
    let total = 1000;
    const calls = stubBackend((c) => {
      if (c.url === "/api/orders/quote") return Response.json({ quote: { currency: "USD", totalAmount: total, lines: [] } });
      if (c.url === "/api/orders" && orderCalls(calls).length === 1) {
        total = 1500;
        return Response.json({ error: "The price has changed. Please review the new total before confirming." }, { status: 409 });
      }
    });
    await ready();
    await click(cta(), "Continue to Payment");
    await waitFor(() => container.textContent!.includes("The price has changed"), "409 message");
    expect(h.redirect).not.toHaveBeenCalled();
    await waitFor(() => container.textContent!.includes("$15.00"), "refreshed quote");
    await click(cta(), "Continue with the new price");
    await waitFor(() => h.redirect.mock.calls.length === 1, "redirect");
    const [first, second] = orderCalls(calls);
    expect(second.body.expectedTotal.amount).toBe(1500);
    expect(second.headers["Idempotency-Key"]).not.toBe(first.headers["Idempotency-Key"]);
  });

  it("a service without a price cannot be ordered and says why", async () => {
    const calls = stubBackend();
    await renderService(offer, { orderable: false, testMode: false, reason: "unpriced" });
    await fillRequired(offer);
    await act(async () => {
      await sleep(400);
    });
    expect(buttonByText(container, "Unavailable")?.disabled).toBe(true);
    expect(container.textContent).toContain("Pricing for this service is not available yet.");
    expect(calls).toHaveLength(0);
  });
});
