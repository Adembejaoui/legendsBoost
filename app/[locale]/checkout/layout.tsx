import type { Metadata } from "next";

/** Payment return pages are private: never indexed (also blocked in robots.txt). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
