"use client";

import { useEffect, useState, useCallback } from "react";
import { Bell, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { NotificationIcon } from "./NotificationIcon";
import { notificationTone, TONE_CLASSES } from "@/lib/notifications/tones";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  orderId: string | null;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const { toast } = useToast();

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?page=${pageNum}&limit=20`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (append) {
        setNotifications((prev) => [...prev, ...data.notifications]);
      } else {
        setNotifications(data.notifications);
      }
      setHasMore(data.notifications.length === 20);
      setTotal(data.total);
      setPage(pageNum);
    } catch {
      toast({ title: "Error", description: "Failed to load notifications", type: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const res = await fetch(`/api/notifications/${notificationId}`, { method: "PATCH" });
      if (!res.ok) throw new Error("Failed to mark as read");
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch {
      toast({ title: "Error", description: "Failed to mark as read", type: "destructive" });
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const res = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!res.ok) throw new Error("Failed to mark all as read");
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast({ type: "success", title: "All notifications marked as read" });
    } catch {
      toast({ title: "Error", description: "Failed to mark all as read", type: "destructive" });
    }
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }
    if (notification.orderId) {
      window.location.assign(`/dashboard/${notification.orderId}`);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage !== page && !isLoading) {
      fetchNotifications(newPage);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {total === 0 ? "No notifications yet" : `${total} notification${total !== 1 ? "s" : ""}`}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-400 transition-colors hover:bg-violet-500/20"
          >
            <Check className="size-4" />
            Mark all as read
          </button>
        )}
      </header>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-12 text-center">
          <Bell className="size-16 text-zinc-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-1">No notifications</h3>
          <p className="text-zinc-500">You&apos;re all caught up. New notifications will appear here.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1117]">
            <ul className="divide-y divide-white/[0.06]">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={cn(
                    "relative cursor-pointer px-5 py-4 pl-6 transition-colors sm:px-6 sm:pl-7",
                    notification.read ? "hover:bg-white/[0.04]" : cn(TONE_CLASSES[notificationTone(notification.type)].surface, "border-0 hover:brightness-110")
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0 w-1",
                      TONE_CLASSES[notificationTone(notification.type)].bar,
                      notification.read && "opacity-40"
                    )}
                  />
                  <div className="flex items-start gap-4">
                    <NotificationIcon type={notification.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3
                              className={cn(
                                "text-sm",
                                notification.read ? "font-semibold text-zinc-200" : cn("font-bold", TONE_CLASSES[notificationTone(notification.type)].title)
                              )}
                            >
                              {notification.title}
                            </h3>
                            {!notification.read && (
                              <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white">New</span>
                            )}
                          </div>
                          <p className={cn("mt-1 text-sm", notification.read ? "text-zinc-500" : "text-zinc-300")}>{notification.message}</p>
                        </div>
                        <time className="flex-shrink-0 whitespace-nowrap text-xs text-zinc-500" dateTime={notification.createdAt}>
                          {formatTime(notification.createdAt)}
                        </time>
                      </div>
                      {notification.orderId && (
                        <div className={cn("mt-2 flex items-center gap-1 text-xs font-medium", TONE_CLASSES[notificationTone(notification.type)].icon)}>
                          <span>View order #{notification.orderId.slice(-8).toUpperCase()}</span>
                          <ChevronRight className="size-3" />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {(hasMore || page > 1) && (
            <nav className="flex items-center justify-center gap-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1 || isLoading}
                className={cn(
                  "rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors",
                  page === 1 || isLoading
                    ? "text-zinc-500 cursor-not-allowed"
                    : "text-zinc-200 hover:bg-white/10"
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
                  !hasMore || isLoading
                    ? "text-zinc-500 cursor-not-allowed"
                    : "text-zinc-200 hover:bg-white/10"
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