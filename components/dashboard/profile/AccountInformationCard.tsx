import { Shield, Calendar, KeyRound, Plug } from "lucide-react";

export function AccountInformationCard({
  role,
  createdAt,
  providers,
  hasPassword,
}: {
  role: string;
  createdAt: Date | string;
  providers: string[];
  hasPassword: boolean;
}) {
  const date = new Date(createdAt).toLocaleDateString();
  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Shield className="size-5 text-violet-400" />
        <h2 className="text-lg font-semibold text-white">Account Information</h2>
      </div>
      <div className="space-y-3">
        <Row label="Role" value={role} />
        <Row label="Member since" value={date} icon={<Calendar className="size-4" />} />
        <Row
          label="Connected providers"
          value={providers.length ? providers.join(", ") : "Unavailable"}
          icon={<Plug className="size-4" />}
        />
        <Row
          label="Local password"
          value={hasPassword ? "Configured" : "Not configured"}
          icon={<KeyRound className="size-4" />}
        />
      </div>
    </section>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-zinc-400">
        {icon}
        {label}
      </span>
      <span className="text-sm font-medium text-white">{value}</span>
    </div>
  );
}
