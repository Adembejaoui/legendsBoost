import { Clock } from "lucide-react";

interface CustomerOrderTimelineProps {
  events: Array<{ id: string; type: string; message: string | null; createdAt: Date }>;
  orderStatus: string;
}

export function CustomerOrderTimeline({ events, orderStatus }: CustomerOrderTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center">
        <Clock className="mx-auto size-8 text-zinc-600 mb-3" />
        <p className="text-sm text-zinc-400">No timeline events yet.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-white/10" />
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        return (
          <div key={event.id} className="relative pl-10 pb-6 last:pb-0">
            <div className="absolute left-0 top-2 size-3 rounded-full border border-white border-white/5 bg-[#111319]" />
            <div className="text-sm text-zinc-400">{new Date(event.createdAt).toLocaleString()}</div>
            <div className="mt-1 text-sm text-white">{event.type}</div>
            {event.message && (
              <div className="mt-1 text-sm text-zinc-400">{event.message}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
