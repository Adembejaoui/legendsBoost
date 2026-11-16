/** Storefront shapes and labels (no server imports: safe for any component). */
export type ServiceAvailability = "available" | "unpriced" | "unavailable" | "unknown";

export interface StorefrontService {
  serviceSlug: string;
  availability: ServiceAvailability;
  startingPrice: { amount: number; currency: string } | null;
}

export const AVAILABILITY_LABEL: Record<ServiceAvailability, string> = {
  available: "Available",
  unpriced: "Price coming soon",
  unavailable: "Under review",
  unknown: "Price shown at configuration",
};
