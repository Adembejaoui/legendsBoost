"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Send, Loader2, Paperclip, ChevronDown, AlertCircle, RotateCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { DELETED_USER_LABEL } from "@/lib/messages/sender";
import {
  applyReadReceipt,
  createClientMessageId,
  isConfirmed,
  latestConfirmedTimestamp,
  mergeMessages,
  normalizeServerMessage,
  oldestConfirmedTimestamp,
  removePending,
  type ChatMessage,
  type RawServerMessage,
} from "@/lib/chat/message-sync";
import type { ChatConnectionState, OrderLifecycleEvent } from "@/lib/chat/realtime-sync";
import { useOrderChatRealtime } from "./useOrderChatRealtime";

interface OrderChatProps {
  orderId: string;
  conversationId: string;
  currentUserId: string;
  currentUserName: string | null;
  currentUserImage: string | null;
  initialMessages: RawServerMessage[];
  isCustomer: boolean;
  isBooster: boolean;
  /** The other participant, shown in the header. */
  participant?: { name: string | null; roleLabel: string } | null;
  /** Fill the parent's height instead of the default 400-600px box. */
  fill?: boolean;
  /** Order lifecycle events received on the order channel. */
  onOrderEvent?: (event: OrderLifecycleEvent, payload: { orderId: string; newStatus?: string }) => void;
}

const PAGE_SIZE = 50;
/** Distance from the bottom (px) within which we keep the view pinned. */
const NEAR_BOTTOM_PX = 120;

const STATUS_LABEL: Record<ChatConnectionState, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  unauthorized: "No access",
  unavailable: "Live updates unavailable",
};

const STATUS_DOT: Record<ChatConnectionState, string> = {
  connecting: "bg-amber-400 animate-pulse",
  live: "bg-green-500",
  reconnecting: "bg-amber-400 animate-pulse",
  offline: "bg-zinc-500",
  unauthorized: "bg-red-500",
  unavailable: "bg-zinc-500",
};

export function OrderChat({
  orderId,
  conversationId,
  currentUserId,
  currentUserName,
  currentUserImage,
  initialMessages,
  isCustomer,
  participant,
  fill = false,
  onOrderEvent,
}: OrderChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    mergeMessages([], initialMessages.map(normalizeServerMessage))
  );
  const [newMessage, setNewMessage] = useState("");
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [hasMore, setHasMore] = useState(initialMessages.length >= PAGE_SIZE);
  const [unseenCount, setUnseenCount] = useState(0);

  const messagesRef = useRef(messages);
  useLayoutEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  /** Set right before prepending older history, to preserve scroll position. */
  const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const forceScrollRef = useRef(true);
  const { toast } = useToast();

  // ------------------------------------------------------------ realtime
  const handleIncoming = useCallback(
    (incoming: ChatMessage[]) => {
      if (!nearBottomRef.current) {
        const known = new Set(messagesRef.current.map((m) => m.id));
        const fresh = incoming.filter(
          (m) => !known.has(m.id) && m.senderId !== currentUserId
        ).length;
        if (fresh) setUnseenCount((c) => c + fresh);
      }
      setMessages((prev) => mergeMessages(prev, incoming));
    },
    [currentUserId]
  );

  const { connectionState, resync } = useOrderChatRealtime({
    orderId,
    currentUserId,
    getCursor: () => latestConfirmedTimestamp(messagesRef.current),
    onMessages: handleIncoming,
    soundOnIncoming: isCustomer,
    onRead: (p) => {
      if (p.readerId === currentUserId) return;
      setMessages((prev) => applyReadReceipt(prev, p.messageIds, p.readAt));
    },
    onOrderEvent,
  });

  const canSend = connectionState !== "unauthorized";

  // ------------------------------------------------------------ scrolling
  /** Scroll the message list itself; never the page or other ancestors. */
  const scrollListToEnd = useCallback((smooth: boolean) => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (smooth && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const anchor = prependAnchorRef.current;
    if (anchor) {
      // Older messages were prepended: keep the user's reading position.
      el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
      prependAnchorRef.current = null;
      return;
    }
    if (forceScrollRef.current || nearBottomRef.current) {
      const instant = forceScrollRef.current;
      forceScrollRef.current = false;
      scrollListToEnd(!instant);
      setUnseenCount(0);
    }
  }, [messages, scrollListToEnd]);

  const scrollToBottom = () => {
    scrollListToEnd(true);
    setUnseenCount(0);
  };

  // ------------------------------------------------------------ sending
  const postMessage = useCallback(
    async (clientMessageId: string, content: string) => {
      try {
        const res = await fetch(`/api/orders/${orderId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, clientMessageId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to send message");
        }

        const data = await res.json();
        if (data?.message) {
          const confirmed = { ...normalizeServerMessage(data.message), clientMessageId };
          setMessages((prev) => mergeMessages(prev, [confirmed]));
        }
        if (data?.moderated) {
          toast({ title: "Part of your message was hidden", description: data.notice, type: "destructive" });
        }
      } catch (err: unknown) {
        const network = err instanceof TypeError; // fetch() network failure
        const description = network
          ? "Network error. Check your connection and retry."
          : (err instanceof Error && err.message) || "Failed to send message";
        setMessages((prev) => {
          // The realtime echo may already have confirmed it; only mark if still pending.
          const stillPending = prev.some(
            (m) => !isConfirmed(m) && m.clientMessageId === clientMessageId
          );
          if (!stillPending) return prev;
          return prev.map((m) =>
            !isConfirmed(m) && m.clientMessageId === clientMessageId
              ? { ...m, status: "failed" as const, error: description }
              : m
          );
        });
        // A network failure is ambiguous (the server may have committed it);
        // a catch-up shows the message if it was in fact stored.
        if (network) resync();
        toast({ title: "Message not sent", description, type: "destructive" });
      }
    },
    [orderId, resync, toast]
  );

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const content = newMessage.trim();
    if (!content || !canSend) return;

    const clientMessageId = createClientMessageId();
    const optimistic: ChatMessage = {
      id: `local-${clientMessageId}`,
      conversationId,
      senderId: currentUserId,
      content,
      messageType: "text",
      readAt: null,
      createdAt: new Date().toISOString(),
      sender: { id: currentUserId, name: currentUserName, image: currentUserImage },
      status: "sending",
      clientMessageId,
    };

    forceScrollRef.current = true;
    setNewMessage("");
    setMessages((prev) => mergeMessages(prev, [optimistic]));
    void postMessage(clientMessageId, content);
  };

  const retryMessage = (m: ChatMessage) => {
    if (!m.clientMessageId) return;
    const clientMessageId = m.clientMessageId;
    setMessages((prev) =>
      mergeMessages(prev, [{ ...m, status: "sending", error: null }])
    );
    void postMessage(clientMessageId, m.content);
  };

  const discardMessage = (m: ChatMessage) => {
    if (!m.clientMessageId) return;
    setMessages((prev) => removePending(prev, m.clientMessageId!));
  };

  // ------------------------------------------------------------ history
  const loadMoreMessages = async () => {
    if (isLoadingOlder || !hasMore) return;
    const before = oldestConfirmedTimestamp(messagesRef.current);
    if (!before) {
      setHasMore(false);
      return;
    }
    setIsLoadingOlder(true);
    setOlderError(false);

    try {
      const qs = new URLSearchParams({ before, limit: String(PAGE_SIZE), markRead: "false" });
      const res = await fetch(`/api/orders/${orderId}/messages?${qs}`);
      if (!res.ok) throw new Error("Failed to load messages");
      const data = await res.json();
      const older: ChatMessage[] = ((data.messages ?? []) as RawServerMessage[]).map(normalizeServerMessage);

      if (older.length < PAGE_SIZE) setHasMore(false);

      const el = messagesContainerRef.current;
      if (el && older.length) {
        prependAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
      }
      setMessages((prev) => mergeMessages(prev, older));
    } catch {
      setOlderError(true);
      toast({ title: "Error", description: "Failed to load more messages", type: "destructive" });
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // ------------------------------------------------------------ formatting
  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (msgDate.getTime() === today.getTime()) {
      return "Today";
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (msgDate.getTime() === yesterday.getTime()) {
      return "Yesterday";
    }

    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  const shouldShowDateSeparator = (index: number) => {
    if (index === 0) return true;
    const current = new Date(messages[index].createdAt);
    const previous = new Date(messages[index - 1].createdAt);
    return current.toDateString() !== previous.toDateString();
  };

  // Reset pinned-to-bottom when switching conversations.
  useEffect(() => {
    forceScrollRef.current = true;
    nearBottomRef.current = true;
  }, [orderId]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-white/10 bg-white/5",
        fill ? "h-full min-h-0" : "h-full min-h-[400px] max-h-[600px]"
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        {participant ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-200"
            >
              {(participant.name ?? "?").slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">{participant.name ?? "Not assigned yet"}</h3>
              <p className="truncate text-[11px] text-zinc-500">{participant.roleLabel}</p>
            </div>
          </div>
        ) : (
          <h3 className="font-semibold text-white">Chat</h3>
        )}
        <div className="flex items-center gap-2 text-xs text-zinc-500" aria-live="polite">
          <span className="flex items-center gap-1" title={STATUS_LABEL[connectionState]}>
            <span className={cn("relative flex h-2 w-2 rounded-full", STATUS_DOT[connectionState])} />
            {STATUS_LABEL[connectionState]}
          </span>
        </div>
      </div>

      {connectionState === "unauthorized" && (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-300">
          <AlertCircle className="size-4 flex-shrink-0" />
          You no longer have access to this conversation.
        </div>
      )}
      {(connectionState === "offline" || connectionState === "unavailable") && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-400">
          <AlertCircle className="size-4 flex-shrink-0" />
          {connectionState === "offline"
            ? "You're offline. New messages will appear when the connection is restored."
            : "Live updates are unavailable. Refresh to see new messages."}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div
          ref={messagesContainerRef}
          className="h-full overflow-y-auto overscroll-contain p-4 space-y-4"
          onScroll={(e) => {
            const target = e.currentTarget;
            const distance = target.scrollHeight - target.scrollTop - target.clientHeight;
            nearBottomRef.current = distance < NEAR_BOTTOM_PX;
            if (nearBottomRef.current && unseenCount) setUnseenCount(0);
            if (target.scrollTop === 0 && hasMore && !isLoadingOlder && !olderError) {
              loadMoreMessages();
            }
          }}
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <Paperclip className="size-12 mb-2" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs">Start the conversation!</p>
            </div>
          ) : (
            <>
              {isLoadingOlder && (
                <div className="flex justify-center py-2">
                  <Loader2 className="size-5 animate-spin text-zinc-500" />
                </div>
              )}
              {olderError && (
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOlderError(false);
                      loadMoreMessages();
                    }}
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    Couldn&apos;t load older messages. Retry
                  </button>
                </div>
              )}
              {messages.map((message, index) => {
                const isOwn = message.senderId === currentUserId;
                const showDate = shouldShowDateSeparator(index);
                const isPending = message.status === "sending";
                const isFailed = message.status === "failed";

                return (
                  <div key={message.clientMessageId && !isConfirmed(message) ? `local-${message.clientMessageId}` : message.id} className="w-full">
                    {showDate && (
                      <div className="flex items-center justify-center gap-2 my-2">
                        <div className="h-px flex-1 bg-white/10 max-w-xs" />
                        <span className="text-xs text-zinc-500 px-2">{formatDate(message.createdAt)}</span>
                        <div className="h-px flex-1 bg-white/10 max-w-xs" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex gap-2 max-w-[80%]",
                        isOwn ? "justify-end ml-auto" : "justify-start"
                      )}
                    >
                      {!isOwn && message.sender?.image && (
                        <img
                          src={message.sender.image}
                          alt=""
                          className="size-8 rounded-full object-cover flex-shrink-0"
                        />
                      )}
                      <div
                        className={cn(
                          "rounded-2xl px-4 py-2",
                          isOwn
                            ? "bg-violet-500/20 border border-violet-500/30 text-white rounded-br-md"
                            : "bg-white/5 border border-white/10 text-white rounded-bl-md",
                          isPending && "opacity-70",
                          isFailed && "border-red-500/40 bg-red-500/10"
                        )}
                      >
                        {!isOwn && (
                          <p className="text-xs text-zinc-400 mb-1">
                            {message.sender?.name ?? DELETED_USER_LABEL}
                          </p>
                        )}
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        <div className="flex items-center justify-end gap-1 mt-1">
                          {isPending ? (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <Loader2 className="size-3 animate-spin" />
                              Sending…
                            </span>
                          ) : isFailed ? (
                            <span className="flex items-center gap-2 text-[10px] text-red-300">
                              <span className="flex items-center gap-1">
                                <AlertCircle className="size-3" />
                                Not sent
                              </span>
                              <button
                                type="button"
                                onClick={() => retryMessage(message)}
                                className="flex items-center gap-0.5 underline hover:text-white"
                              >
                                <RotateCw className="size-3" />
                                Retry
                              </button>
                              <button
                                type="button"
                                onClick={() => discardMessage(message)}
                                className="flex items-center gap-0.5 underline hover:text-white"
                                aria-label="Discard message"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ) : (
                            <>
                              <time
                                className="text-[10px] text-zinc-500"
                                dateTime={message.createdAt}
                                title={new Date(message.createdAt).toLocaleString()}
                              >
                                {formatTime(message.createdAt)}
                              </time>
                              {isOwn && message.readAt && <ChevronDown className="size-3 text-green-400" />}
                            </>
                          )}
                        </div>
                      </div>
                      {isOwn && currentUserImage && (
                        <img
                          src={currentUserImage}
                          alt=""
                          className="size-8 rounded-full object-cover flex-shrink-0"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {unseenCount > 0 && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-violet-500 px-3 py-1 text-xs text-white shadow-lg hover:bg-violet-400"
          >
            <ChevronDown className="size-3" />
            {unseenCount === 1 ? "1 new message" : `${unseenCount} new messages`}
          </button>
        )}
      </div>

      <form onSubmit={handleSendMessage} className={cn("border-t border-white/10", fill ? "p-3" : "p-4")}>
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={canSend ? "Type a message..." : "You can no longer send messages here"}
              rows={1}
              maxLength={5000}
              className={cn(
                "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-white",
                "placeholder:text-zinc-500",
                "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent",
                "resize-none"
              )}
              style={{ minHeight: "44px" }}
              disabled={!canSend}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            />
          </div>
          <button
            type="submit"
            disabled={!newMessage.trim() || !canSend}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
              "bg-violet-500 text-white hover:bg-violet-400",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            aria-label="Send message"
          >
            <Send className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
