import { User2 } from "lucide-react";

interface CustomerProfileCardProps {
  user: {
    name: string | null;
    email: string;
    role: string;
    createdAt?: string | Date;
    customerProfile: {
      phoneNumber: string | null;
      country: string | null;
    } | null;
  };
}

export function CustomerProfileCard({ user }: CustomerProfileCardProps) {
  const profile = user.customerProfile;

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="flex-1">
        <div className="text-base font-semibold text-white">{user.name || user.email}</div>
        <div className="mt-1 text-sm text-zinc-400">{user.email}</div>
        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-xs text-zinc-400">
          <User2 className="size-3.5" /> {user.role}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Email", value: user.email },
          { label: "Phone", value: profile?.phoneNumber ?? "—" },
          { label: "Country", value: profile?.country ?? "—" },
        ].map((field) => (
          <div key={field.label} className="rounded-lg border border-white/10 bg-white/5 p-4">
            <dt className="text-xs text-zinc-500 uppercase tracking-wider">{field.label}</dt>
            <dd className="mt-1 text-sm text-white truncate">{field.value}</dd>
          </div>
        ))}
      </div>
    </section>
  );
}
