"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Bell, X, Check } from "lucide-react";
import { NotificationIcon } from "./NotificationIcon";
import { notificationTone, TONE_CLASSES } from "@/lib/notifications/tones";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

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

interface NotificationBellProps {
  initialUnreadCount?: number;
  /** Admins open orders in the admin order editor. */
  isAdmin?: boolean;
}

export function NotificationBell({ initialUnreadCount = 0, isAdmin = false }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const unreadCount = initialUnreadCount > 0 ? initialUnreadCount : 0;
  // The count comes from the server (refreshed live); reload the list when it changes.
  const [seenCount, setSeenCount] = useState(unreadCount);
  const [listVersion, setListVersion] = useState(0);
  if (seenCount !== unreadCount) {
    setSeenCount(unreadCount);
    setListVersion((v) => v + 1);
  }

  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?page=${pageNum}&limit=10`);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (append) {
        setNotifications((prev) => [...prev, ...data.notifications]);
      } else {
        setNotifications(data.notifications);
      }
      setHasMore(data.notifications.length === 10);
      setPage(pageNum);
    } catch {
      toast({ title: "Error", description: "Failed to load notifications", type: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchNotifications(1);
  }, [fetchNotifications, listVersion]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
      window.location.assign(isAdmin ? `/dashboard/admin/orders/${notification.orderId}` : `/dashboard/${notification.orderId}`);
    }
    setIsOpen(false);
  };

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      fetchNotifications(page + 1, true);
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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative p-2 rounded-xl transition-colors",
          "hover:bg-white/5",
          "text-zinc-400 hover:text-white"
        )}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-96 origin-top-right rounded-xl border border-white/10 bg-[#111319] shadow-lg animate-in fade-in-0 zoom-in-95 duration-150">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <h3 className="font-semibold text-white">Notifications</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 text-zinc-500 hover:text-white"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <Bell className="size-12 text-zinc-600 mb-2" />
                <p className="text-zinc-500">No notifications yet</p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-white/5">
                  {notifications.map((notification) => (
                    <li
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        "relative cursor-pointer py-3 pl-5 pr-4 transition-colors",
                        notification.read ? "hover:bg-white/5" : cn(TONE_CLASSES[notificationTone(notification.type)].surface, "border-0 hover:brightness-110")
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("absolute inset-y-0 left-0 w-1", TONE_CLASSES[notificationTone(notification.type)].bar, notification.read && "opacity-40")}
                      />
                      <div className="flex items-start gap-3">
                        <NotificationIcon type={notification.type} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-sm font-medium", notification.read ? "text-zinc-200" : cn("font-semibold", TONE_CLASSES[notificationTone(notification.type)].title))}>
                              {notification.title}
                            </p>
                            <time className="flex-shrink-0 text-xs text-zinc-500" dateTime={notification.createdAt}>
                              {formatTime(notification.createdAt)}
                            </time>
                          </div>
                          <p className="mt-1 text-sm text-zinc-400 line-clamp-2">{notification.message}</p>
                          {!notification.read && (
                            <div className={cn("mt-1.5 flex items-center gap-1.5 text-xs", TONE_CLASSES[notificationTone(notification.type)].icon)}>
                              <span className="relative flex h-2 w-2">
                                <span className={cn("absolute inset-0 h-full w-full animate-ping rounded-full opacity-75", TONE_CLASSES[notificationTone(notification.type)].bar)} />
                                <span className={cn("relative flex h-full w-full rounded-full", TONE_CLASSES[notificationTone(notification.type)].bar)} />
                              </span>
                              Unread
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {hasMore && (
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoading}
                    className="w-full py-3 text-sm text-zinc-400 hover:text-white transition-colors border-t border-white/5"
                  >
                    {isLoading ? "Loading..." : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}