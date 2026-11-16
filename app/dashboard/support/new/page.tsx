"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Send, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

export default function NewTicketPage() {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("ORDER_ISSUE");
  const [priority, setPriority] = useState("MEDIUM");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Opened from an order page ("Get help with this order"): link the ticket to it.
  const [orderId, setOrderId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orderId");
    // Read once after mount (window is not available during server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) setOrderId(id);
  }, []);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim() || !description.trim()) {
      toast({ title: "Error", description: "Please fill in all required fields", type: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          ...(orderId ? { orderId } : {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create ticket");
      }

      const data = await res.json();
      toast({ type: "success", title: "Ticket created", description: "Our team will review your request shortly" });
      window.location.href = `/dashboard/support/${data.ticket.id}`;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, type: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header className="flex items-center gap-2">
        <Link href="/dashboard/support" className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft className="size-4" />
          Back to Tickets
        </Link>
      </header>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-bold text-white mb-2">Create Support Ticket</h1>
        <p className="text-zinc-400 mb-6">Fill in the details below to submit a support request.</p>
        {orderId && (
          <p className="-mt-3 mb-6 text-sm text-zinc-400">
            About order <span className="font-mono text-white">#{orderId.slice(-8).toUpperCase()}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="subject" className="block text-sm font-medium text-white mb-2">
              Subject <span className="text-red-400">*</span>
            </label>
            <input
              id="subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="category" className="block text-sm font-medium text-white mb-2">
              Category <span className="text-red-400">*</span>
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent"
              required
            >
              <option value="ORDER_ISSUE">Order Issue</option>
              <option value="BOOSTER_ISSUE">Booster Issue</option>
              <option value="PAYMENT_ISSUE">Payment Issue</option>
              <option value="TECHNICAL_ISSUE">Technical Issue</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="priority" className="block text-sm font-medium text-white mb-2">
              Priority
            </label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-white mb-2">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your issue in detail..."
              rows={6}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent resize-y"
              required
            />
          </div>

          <div className="flex gap-3 pt-4 border-t border-white/10">
            <Link
              href="/dashboard/support"
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-transparent px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Submit Ticket
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}