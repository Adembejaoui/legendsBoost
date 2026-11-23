"use client";

import { useRouter } from "@/i18n/navigation";

/** Key read by the checkout to preselect the booster (if they can do the order). */
export const PREFERRED_BOOSTER_KEY = "lb.preferredBooster";

export function ChooseBoosterButton({ boosterId, name }: { boosterId: string; name: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          sessionStorage.setItem(PREFERRED_BOOSTER_KEY, boosterId);
        } catch {
          /* storage unavailable: the customer can still pick them at checkout */
        }
        router.push("/games");
      }}
      className="rounded-lg bg-[#C8AA6E] px-4 py-2 text-sm font-semibold text-[#0A0E14] hover:bg-[#d8bc85]"
    >
      Choose {name}
    </button>
  );
}
