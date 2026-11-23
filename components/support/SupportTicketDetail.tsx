"use client";

import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Send, Loader2, Clock, CheckCircle, X, AlertTriangle, Mail, Shield, MoreVertical, Edit, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Link } from "@/i18n/navigation";
import { DELETED_USER_LABEL } from "@/lib/messages/sender";

interface Message {
  id: string;
  content: string;
  isAdminReply: boolean;
  createdAt: string;
  sender: { id: string; name: string | null; image: string | null } | null;
}

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
  messages: Message[];
}

interface SupportTicketDetailProps {
  ticketId: string;
  isAdmin?: boolean;
}

export function SupportTicketDetail({ ticketId, isAdmin = false }: SupportTicketDetailProps) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const { toast } = useToast();

  const fetchTicket = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`);
      if (!res.ok) throw new Error("Failed to fetch ticket");
      const data = await res.json();
      setTicket(data.ticket);
    } catch {
      toast({ title: "Error", description: "Failed to load ticket", type: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [ticketId, toast]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket, ticketId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    const content = newMessage.trim();
    setIsSending(true);
    setNewMessage("");

    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send message");
      }

      fetchTicket();
    } catch (err: any) {
      setNewMessage(content);
      toast({ title: "Error", description: err.message, type: "destructive" });
    } finally {
      setIsSending(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      fetchTicket();
      toast({ type: "success", title: "Status updated" });
    } catch {
      toast({ title: "Error", description: "Failed to update status", type: "destructive" });
    }
  };

  const handleAssign = async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assign: true }),
      });
      if (!res.ok) throw new Error("Failed to assign ticket");
      fetchTicket();
      toast({ type: "success", title: "Ticket assigned to you" });
    } catch {
      toast({ title: "Error", description: "Failed to assign ticket", type: "destructive" });
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-8 animate-spin text-violet-400" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
        <AlertTriangle className="size-16 text-zinc-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-white mb-1">Ticket not found</h3>
        <p className="text-zinc-500">This support ticket doesn&apos;t exist or you don&apos;t have access to it.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <Link
          href={isAdmin ? "/dashboard/admin/support" : "/dashboard/support"}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to Tickets
        </Link>
      </header>

      <div className="rounded-xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              {getCategoryIcon(ticket.category)}
              <h1 className="text-xl font-bold text-white truncate">{ticket.subject}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={cn("px-2 py-1 rounded border", getStatusBadge(ticket.status))}>
                {ticket.status.replace(/_/g, " ")}
              </span>
              <span className={cn("px-2 py-1 rounded", getPriorityBadge(ticket.priority))}>
                {ticket.priority}
              </span>
              <span className="px-2 py-1 rounded bg-white/5 text-zinc-400 capitalize">
                {ticket.category.replace(/_/g, " ").toLowerCase()}
              </span>
            </div>
          </div>
          {isAdmin && ticket.status !== "CLOSED" && ticket.status !== "RESOLVED" && (
            <div className="flex gap-2">
              {!ticket.assignedAdmin && (
                <button
                  onClick={handleAssign}
                  className="px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-400 text-sm font-medium hover:bg-violet-500/30"
                >
                  Assign to Me
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg bg-white/5 p-4">
            <p className="text-xs text-zinc-400 mb-1">Customer</p>
            <p className="font-medium text-white">{ticket.customer.name ?? "Unknown"}</p>
            <p className="text-sm text-zinc-500">{ticket.customer.email}</p>
          </div>
          <div className="rounded-lg bg-white/5 p-4">
            <p className="text-xs text-zinc-400 mb-1">Order</p>
            {ticket.order ? (
              <>
                <p className="font-medium text-white">#{ticket.order.id.slice(-8).toUpperCase()}</p>
                <p className="text-sm text-zinc-500">{ticket.order.gameSlug} - {ticket.order.serviceSlug}</p>
              </>
            ) : (
              <p className="text-zinc-500">No order linked</p>
            )}
          </div>
          <div className="rounded-lg bg-white/5 p-4">
            <p className="text-xs text-zinc-400 mb-1">Created</p>
            <p className="font-medium text-white">{formatDate(ticket.createdAt)}</p>
            <p className="text-sm text-zinc-500">Updated {formatDate(ticket.updatedAt)}</p>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 mb-6">
          <h3 className="text-lg font-semibold text-white mb-4">Description</h3>
          <p className="text-zinc-300 whitespace-pre-wrap">{ticket.description}</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="border-b border-white/10 p-4">
          <h3 className="text-lg font-semibold text-white">Conversation</h3>
        </div>
        <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
          {ticket.messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex gap-3", message.isAdminReply ? "flex-row-reverse" : "")}
            >
              {!message.isAdminReply && message.sender?.image && (
                <img src={message.sender.image} alt="" className="size-8 rounded-full object-cover flex-shrink-0" />
              )}
              <div className={cn("flex-1 max-w-[70%]", message.isAdminReply ? "text-end" : "")}>
                <div className={cn("rounded-2xl px-4 py-2", message.isAdminReply ? "bg-violet-500/20 border border-violet-500/30 text-white rounded-bl-md" : "bg-white/5 border border-white/10 text-white rounded-br-md")}>
                  {!message.isAdminReply && (
                    <p className="text-xs text-zinc-400 mb-1">{message.sender?.name ?? DELETED_USER_LABEL}</p>
                  )}
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                </div>
                <div className={cn("flex items-center gap-1 mt-1 text-[10px] text-zinc-500", message.isAdminReply ? "justify-end" : "")}>
                  <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                </div>
              </div>
              {message.isAdminReply && message.sender?.image && (
                <img src={message.sender.image} alt="" className="size-8 rounded-full object-cover flex-shrink-0" />
              )}
            </div>
          ))}
        </div>

        <form onSubmit={handleSendMessage} className="border-t border-white/10 p-4">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder={isAdmin ? "Reply to customer..." : "Add a reply..."}
                rows={1}
                className={cn(
                  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white",
                  "placeholder:text-zinc-500",
                  "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent",
                  "resize-none"
                )}
                style={{ minHeight: "44px" }}
                disabled={isSending}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(e);
                  }
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!newMessage.trim() || isSending}
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                "bg-violet-500 text-white hover:bg-violet-400",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              aria-label="Send message"
            >
              {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </form>
      </div>

      {isAdmin && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Admin Actions</h3>
          <div className="flex flex-wrap gap-2">
            {["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"].map((status) => (
              <button
                key={status}
                onClick={() => handleStatusChange(status)}
                disabled={ticket.status === status}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  ticket.status === status
                    ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                    : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white border border-white/10"
                )}
              >
                {status.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}