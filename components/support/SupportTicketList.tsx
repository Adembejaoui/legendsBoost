"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, Mail, AlertTriangle, Clock, CheckCircle, X, ChevronLeft, ChevronRight, Filter, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface Ticket {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  customer: { id: string; name: string | null; email: string | null };
  order: { id: string; gameSlug: string; serviceSlug: string; status: string } | null;
  assignedAdmin: { id: string; name: string | null; email: string | null } | null;
  _count: { messages: number };
}

interface SupportTicketListProps {
  isAdmin?: boolean;
}

export function SupportTicketList({ isAdmin = false }: SupportTicketListProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ status: "", category: "", priority: "" });
  const { toast } = useToast();

  const fetchTickets = useCallback(async (pageNum = 1) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: "20",
        ...(filters.status && { status: filters.status }),
        ...(filters.category && { category: filters.category }),
        ...(filters.priority && { priority: filters.priority }),
      });
      const res = await fetch(`/api/support/tickets?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tickets");
      const data = await res.json();
      setTickets(data.tickets);
      setTotal(data.total);
      setHasMore(data.tickets.length === 20);
      setPage(pageNum);
    } catch {
      toast({ title: "Error", description: "Failed to load tickets", type: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [filters, toast]);

  useEffect(() => {
    fetchTickets(1);
  }, [fetchTickets]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      OPEN: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      IN_PROGRESS: "bg-violet-500/20 text-violet-400 border-violet-500/30",
      WAITING_FOR_CUSTOMER: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      RESOLVED: "bg-green-500/20 text-green-400 border-green-500/30",
      CLOSED: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    };
    return styles[status] || "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  };

  const getPriorityBadge = (priority: string) => {
    const styles: Record<string, string> = {
      LOW: "bg-zinc-500/20 text-zinc-400",
      MEDIUM: "bg-blue-500/20 text-blue-400",
      HIGH: "bg-amber-500/20 text-amber-400",
      URGENT: "bg-red-500/20 text-red-400",
    };
    return styles[priority] || "bg-zinc-500/20 text-zinc-400";
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "ORDER_ISSUE":
        return <Mail className="size-4" />;
      case "BOOSTER_ISSUE":
        return <AlertTriangle className="size-4" />;
      case "PAYMENT_ISSUE":
        return <Clock className="size-4" />;
      case "TECHNICAL_ISSUE":
        return <AlertTriangle className="size-4" />;
      default:
        return <Mail className="size-4" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage !== page && !isLoading) {
      fetchTickets(newPage);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Support Tickets</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {total === 0 ? "No tickets" : `${total} ticket${total !== 1 ? "s" : ""}`}
          </p>
        </div>
        {!isAdmin && (
          <Link
            href="/dashboard/support/new"
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400"
          >
            <Plus className="size-4" />
            New Ticket
          </Link>
        )}
      </header>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap gap-3">
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            className="flex-1 min-w-[150px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="WAITING_FOR_CUSTOMER">Waiting for Customer</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select
            value={filters.category}
            onChange={(e) => setFilters((prev) => ({ ...prev, category: e.target.value }))}
            className="flex-1 min-w-[150px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            <option value="">All Categories</option>
            <option value="ORDER_ISSUE">Order Issue</option>
            <option value="BOOSTER_ISSUE">Booster Issue</option>
            <option value="PAYMENT_ISSUE">Payment Issue</option>
            <option value="TECHNICAL_ISSUE">Technical Issue</option>
            <option value="OTHER">Other</option>
          </select>
          <select
            value={filters.priority}
            onChange={(e) => setFilters((prev) => ({ ...prev, priority: e.target.value }))}
            className="flex-1 min-w-[150px] rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
          >
            <option value="">All Priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
          <Mail className="size-16 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No tickets found</h3>
          <p className="text-zinc-500">{isAdmin ? "No support tickets in the system." : "You haven't created any support tickets yet."}</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Subject</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden lg:table-cell">Priority</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="hover:bg-white/5 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <Link href={isAdmin ? `/dashboard/admin/support/${ticket.id}` : `/dashboard/support/${ticket.id}`} className="block">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(ticket.category)}
                          <span className="font-medium text-white truncate max-w-[300px]">{ticket.subject}</span>
                        </div>
                        <p className="mt-1 text-sm text-zinc-400 line-clamp-1">{ticket.description}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-sm text-zinc-300 capitalize">{ticket.category.replace(/_/g, " ").toLowerCase()}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium", getPriorityBadge(ticket.priority))}>
                        {ticket.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-xs font-medium border", getStatusBadge(ticket.status))}>
                        {ticket.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {ticket.order ? (
                        <span className="text-sm text-zinc-400 font-mono">#{ticket.order.id.slice(-8).toUpperCase()}</span>
                      ) : (
                        <span className="text-sm text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <time className="text-sm text-zinc-400" dateTime={ticket.updatedAt}>
                        {formatDate(ticket.updatedAt)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(hasMore || page > 1) && (
            <nav className="flex items-center justify-center gap-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isLoading}
                className={cn(
                  "rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors",
                  page === 1 || isLoading ? "text-zinc-500 cursor-not-allowed" : "text-zinc-200 hover:bg-white/10"
                )}
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-sm text-zinc-400">
                Page {page} of {Math.ceil(total / 20) || 1}
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={!hasMore || isLoading}
                className={cn(
                  "rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors",
                  !hasMore || isLoading ? "text-zinc-500 cursor-not-allowed" : "text-zinc-200 hover:bg-white/10"
                )}
              >
                <ChevronRight className="size-4" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}