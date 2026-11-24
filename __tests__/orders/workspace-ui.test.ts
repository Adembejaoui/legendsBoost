/* eslint-disable @typescript-eslint/no-explicit-any -- render plumbing */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { workspaceFixture } from "../support/workspace-fixture";

/**
 * Structural UI checks for the order workspace (jsdom has no layout engine:
 * real viewport fit is verified in a browser, see
 * docs/ORDER-WORKSPACE-UI-REDESIGN.md).
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// The real chat opens a Supabase Realtime socket; its behaviour is covered by
// __tests__/chat. Here we only check where and how it is mounted.
vi.mock("@/components/chat/OrderChat", () => ({
  OrderChat: (props: any) =>
    createElement("div", { "data-testid": "chat", "data-fill": String(!!props.fill), "data-participant": props.participant?.name ?? "" }),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import OrderWorkspace from "@/components/orders/workspace/OrderWorkspace";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: "v1" }), { status: 200 }) as any);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(data = workspaceFixture()) {
  act(() => {
    root.render(createElement(OrderWorkspace, { data, initialMessages: [] }));
  });
  return container;
}

const text = () => container.textContent ?? "";
const buttons = () => Array.from(container.querySelectorAll("button")).map((b) => ({ label: b.textContent?.trim() ?? "", disabled: b.disabled }));

describe("order workspace layout", () => {
  it("is a fixed-viewport workspace: full available height, no outer scrolling", () => {
    render();
    const ws = container.querySelector('[data-testid="order-workspace"]')!;
    expect(ws.className).toContain("h-[calc(100dvh-7rem-1px)]");
    expect(ws.className).toContain("overflow-hidden");
    expect(ws.className).toContain("min-h-0");
  });

  it("has details / progress / chat columns, with the rank updates inside the progress column", () => {
    render();
    const ws = container.querySelector('[data-testid="order-workspace"]')!;
    const grid = ws.querySelector('[class*="xl:[grid-template-areas:\x27left_main_chat\x27]"]');
    expect(grid).not.toBeNull();
    expect(grid!.querySelector('section[aria-label="Order details and account"]')?.className).toContain("xl:[grid-area:left]");
    const progress = grid!.querySelector("#ws-progress")!;
    expect(progress.className).toContain("[grid-area:main]");
    expect(progress.querySelector('section[aria-label="Rank progression"]')).not.toBeNull();
    expect(progress.querySelector('section[aria-label="Rank updates"]')).not.toBeNull();
    // Riot tracking is off (decision 2026-11-17): no match history, no stat tiles.
    expect(progress.querySelector('section[aria-label="Match history"]')).toBeNull();
    expect(grid!.querySelector('[class*="lg:[grid-area:chat]"] [data-testid="chat"]')).not.toBeNull();
  });

  it("scrolls only inside panels: chat fills its column, updates and details scroll internally", () => {
    render();
    expect(container.querySelector('[data-testid="chat"]')!.getAttribute("data-fill")).toBe("true");
    const updatesBody = container.querySelector('section[aria-label="Rank updates"] ol')!;
    expect(updatesBody.className).toContain("overflow-y-auto");
    const details = container.querySelector('section[aria-label="Order details and account"]')!;
    expect(details.className).toContain("overflow-hidden");
    expect(details.querySelector(".overflow-y-auto")).not.toBeNull();
  });

  it("shows the other participant in the chat header", () => {
    render(workspaceFixture({ role: "customer" }));
    expect(container.querySelector('[data-testid="chat"]')!.getAttribute("data-participant")).toBe("Test Booster");
  });

  it("uses a bottom tab bar below lg so mobile never gets three tiny columns", () => {
    render();
    const nav = container.querySelector('nav[role="tablist"]')!;
    expect(nav.className).toContain("lg:hidden");
    expect(Array.from(nav.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual(["Progress", "Details", "Chat"]);
  });

  it("colours the page after the game", () => {
    render();
    const ws = container.querySelector('[data-testid="order-workspace"]') as HTMLElement;
    expect(ws.dataset.game).toBe("league-of-legends");
    expect(ws.style.getPropertyValue("--g-accent")).toBe("#C8AA6E");
  });

  it("lists the booster's rank updates newest first", () => {
    const data = workspaceFixture();
    data.updates.list = [
      { id: "u2", label: "Gold I", tierId: "gold", divisionId: "i", lp: 64, gamesDone: null, iconSrc: null, at: "2026-11-17T10:00:00.000Z" },
      { id: "u1", label: "Gold III", tierId: "gold", divisionId: "iii", lp: null, gamesDone: null, iconSrc: null, at: "2026-11-16T10:00:00.000Z" },
    ];
    render(data);
    const rows = Array.from(container.querySelectorAll('section[aria-label="Rank updates"] li'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Gold I");
    expect(rows[0].textContent).toContain("64 LP");
    expect(rows[0].textContent).toContain("Latest");
    expect(rows[1].textContent).toContain("Gold III");
  });
});

describe("rank updates", () => {
  it("the working booster gets 'Update rank'; customers and admins do not", () => {
    const booster = workspaceFixture({ role: "booster" });
    booster.updates.canPost = true;
    booster.updates.rankOptions = [{ tierId: "gold", name: "Gold", iconSrc: null, divisions: [{ id: "iv", label: "IV" }] }];
    render(booster);
    expect(buttons().some((b) => b.label.includes("Update rank"))).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    render(workspaceFixture({ role: "customer" }));
    expect(buttons().some((b) => b.label.includes("Update rank"))).toBe(false);
  });

  it("the customer gets a link to check the rank on OP.GG", () => {
    const data = workspaceFixture({ role: "customer" });
    data.updates.selfCheck = { label: "Check on OP.GG", url: "https://op.gg/lol/summoners/euw/Name-EUW" };
    render(data);
    const link = Array.from(container.querySelectorAll("a")).find((a) => a.textContent?.includes("Check on OP.GG"))!;
    expect(link.getAttribute("href")).toBe("https://op.gg/lol/summoners/euw/Name-EUW");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("removed features", () => {
  it.each(["customer", "booster", "admin"] as const)("%s view has no activity timeline and no Riot sync", (role) => {
    render(workspaceFixture({ role }));
    expect(text()).not.toMatch(/Sync Riot data/i);
    expect(container.querySelector('section[aria-label="Activity"]')).toBeNull();
    expect(text()).not.toMatch(/No activity yet/);
  });
});

describe("order actions", () => {
  it("customer: Pause on an in-progress order, no booster actions", () => {
    render(workspaceFixture({ role: "customer" }));
    const labels = buttons().map((b) => b.label);
    expect(labels).toContain("Pause order");
    expect(labels).not.toContain("Resume order");
    expect(labels).not.toContain("Complete");
    expect(labels).not.toContain("Abandon");
  });

  it("customer: Resume on a paused order and a visible PAUSED banner", () => {
    render(workspaceFixture({ role: "customer", paused: true }));
    expect(buttons().map((b) => b.label)).toContain("Resume order");
    const banner = container.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain("PAUSED");
    expect(banner.textContent).toContain("You paused this order");
  });

  it("booster: only Complete and Abandon; never pause or resume", () => {
    render(workspaceFixture({ role: "booster" }));
    const labels = buttons().map((b) => b.label);
    expect(labels).toEqual(expect.arrayContaining(["Complete", "Abandon"]));
    expect(labels.some((l) => /pause|resume/i.test(l))).toBe(false);
  });

  it("booster on a paused order: STOP banner, Complete and Abandon disabled", () => {
    render(workspaceFixture({ role: "booster", paused: true }));
    const banner = container.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain("Order paused by the customer. Stop boosting immediately.");
    expect(banner.textContent).toContain("Do not continue playing on the customer's account until the order is resumed.");
    const b = buttons();
    expect(b.find((x) => x.label === "Complete")?.disabled).toBe(true);
    expect(b.find((x) => x.label === "Abandon")?.disabled).toBe(true);
    expect(b.some((x) => /resume/i.test(x.label))).toBe(false);
  });

  it("admin: no customer or booster action buttons", () => {
    render(workspaceFixture({ role: "admin", paused: true }));
    const labels = buttons().map((b) => b.label);
    expect(labels.some((l) => /pause|resume|complete|abandon/i.test(l))).toBe(false);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Paused by the customer");
  });

  it.each(["COMPLETED", "CANCELLED", "PENDING"])("%s order: no usable pause / complete / abandon", (status) => {
    // Booster: none of the buttons. Customer (client PDF 2026-11-21): the four
    // header buttons are always shown; Pause is greyed out here.
    render(workspaceFixture({ role: "booster", status }));
    expect(buttons().some((b) => /pause|resume|complete|abandon/i.test(b.label))).toBe(false);
    render(workspaceFixture({ role: "customer", status }));
    const usable = buttons().filter((b) => !b.disabled).map((b) => b.label);
    expect(usable.some((l) => /pause|resume|complete|abandon/i.test(l))).toBe(false);
    expect(buttons().find((b) => b.label === "Pause order")?.disabled).toBe(true);
  });

  it("customer header: Tip, Pause, Change booster and Poke side by side; no cancellation button", () => {
    render(workspaceFixture({ role: "customer", status: "IN_PROGRESS" }));
    const group = container.querySelector('[role="group"][aria-label="Order actions"]')!;
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Tip", "Pause order", "Change booster", "Poke booster"]);
    expect(container.textContent).not.toContain("Request cancellation");
  });
});

describe("rank progression per game", () => {
  it("League: Riot current rank and target with League emblems", () => {
    render(workspaceFixture({ game: "league-of-legends" }));
    const panel = container.querySelector('section[aria-label="Rank progression"]')!;
    expect(panel.textContent).toContain("Current rank");
    expect(panel.textContent).toContain("Gold I");
    expect(panel.textContent).toContain("64 LP");
    expect(panel.textContent).toContain("Platinum IV");
    expect(panel.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("81");
  });

  it("VALORANT: VALORANT emblems and divisions, honest 'not tracked' state, no invented LP or %", () => {
    render(workspaceFixture({ game: "valorant" }));
    const panel = container.querySelector('section[aria-label="Rank progression"]')!;
    expect(panel.textContent).toContain("Starting rank");
    expect(panel.textContent).toContain("Gold 2");
    expect(panel.textContent).toContain("Platinum 1");
    expect(panel.textContent).not.toMatch(/\d+ LP/);
    expect(panel.querySelector('[role="progressbar"]')).toBeNull();
    const imgs = Array.from(panel.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(imgs.every((src) => src?.includes("valorant-rank-icons"))).toBe(true);
  });

  it("TFT: tiers and divisions from the order, no Riot League data shown", () => {
    render(workspaceFixture({ game: "teamfight-tactics" }));
    const panel = container.querySelector('section[aria-label="Rank progression"]')!;
    expect(panel.textContent).toContain("Gold IV");
    expect(panel.textContent).toContain("Platinum IV");
    expect(panel.textContent).not.toContain("Riot data");
  });
});
