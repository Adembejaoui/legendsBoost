/** Shown instantly while a dashboard page loads its data (no blank screen). */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse space-y-4 p-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-lg bg-white/[0.06]" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-white/[0.04]" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 rounded-xl bg-white/[0.04]" />
      ))}
    </div>
  );
}
