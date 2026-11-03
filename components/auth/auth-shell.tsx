import Link from "next/link";
import { Barlow_Condensed } from "next/font/google";

export const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

// Edit these to match the ranks your service actually offers.
const TIERS = [
  { name: "Iron", color: "#7b7b80" },
  { name: "Bronze", color: "#a06a45" },
  { name: "Silver", color: "#9aa6b2" },
  { name: "Gold", color: "#c8aa6e" },
  { name: "Platinum", color: "#4e9996" },
  { name: "Emerald", color: "#2da36b" },
  { name: "Diamond", color: "#576bce" },
  { name: "Master", color: "#9d48e0" },
  { name: "Grandmaster", color: "#c2453d" },
  { name: "Challenger", color: "#f4c874" },
];

function RankLadder() {
  // Highest tier on top, widest bar on top: the staircase reads as a climb.
  const rungs = TIERS.map((tier, i) => ({ ...tier, width: 26 + i * 8 })).reverse();

  return (
    <ol className="space-y-2" aria-label="Ranked tiers from Challenger down to Iron">
      {rungs.map((tier) => (
        <li key={tier.name} className="flex items-center gap-4">
          <span className="w-24 text-right text-sm text-zinc-500">{tier.name}</span>
          <span
            className="h-3.5 rounded-r-sm"
            style={{ width: `${tier.width}%`, backgroundColor: tier.color, opacity: 0.85 }}
          />
        </li>
      ))}
    </ol>
  );
}

function Brand({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`${display.className} text-2xl font-semibold tracking-wide text-white ${className}`}
    >
      Legends<span className="text-[#C8AA6E]">Boost</span>
    </Link>
  );
}

export function AuthShell({
  title,
  subtitle,
  sideHeading,
  sideNote,
  children,
}: {
  title: string;
  subtitle: string;
  sideHeading: string;
  sideNote: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen bg-[#070A12] lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-white/10 p-12 lg:flex xl:p-16">
        <Brand />
        <div>
          <h2
            className={`${display.className} max-w-md text-5xl font-semibold leading-[1.05] tracking-tight text-white xl:text-6xl`}
          >
            {sideHeading}
          </h2>
          <div className="mt-12 max-w-lg">
            <RankLadder />
          </div>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-zinc-500">{sideNote}</p>
      </aside>

      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <Brand className="mb-10 inline-block lg:hidden" />
          <div className="mb-8">
            <h1 className={`${display.className} text-4xl font-semibold tracking-tight text-white`}>
              {title}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}