# Notifications, Order Communication & Support System

## Overview
This document describes the complete implementation of the Notifications, Order Communication, and Support system for the LegendsBoost platform.

## Database Schema Changes

### New Models Added (prisma/schema.prisma)

#### Notification
```prisma
model Notification {
  id        String           @id @default(cuid())
  userId    String           @map("userId")
  type      NotificationType
  title     String
  message   String
  orderId   String?          @map("orderId")
  read      Boolean          @default(false)
  readAt    DateTime?        @map("readAt")
  metadata  Json?
  createdAt DateTime         @default(now()) @map("createdAt")

  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, read])
  @@index([userId, createdAt])
  @@index([orderId])
  @@map("notification")
}
```

#### OrderConversation
```prisma
model OrderConversation {
  id        String   @id @default(cuid())
  orderId   String   @unique @map("orderId")
  closedAt  DateTime? @map("closedAt")
  createdAt DateTime @default(now()) @map("createdAt")
  updatedAt DateTime @updatedAt @map("updatedAt")
}
```

#### OrderMessage
```prisma
model OrderMessage {
  id              String   @id @default(cuid())
  conversationId  String   @map("conversationId")
  senderId        String   @map("senderId")
  content         String
  messageType     String   @default("text") @map("messageType")
  readAt          DateTime? @map("readAt")
  createdAt       DateTime @default(now()) @map("createdAt")

  conversation    OrderConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender          User     @relation("sentOrderMessages", fields: [senderId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@index([senderId])
  @@map("order_message")
}
```

#### SupportTicket
```prisma
model SupportTicket {
  id              String   @id @default(cuid())
  customerId      String   @map("customerId")
  orderId         String?  @map("orderId")
  subject         String
  description     String
  category        TicketCategory @default(ORDER_ISSUE)
  priority        TicketPriority @default(MEDIUM)
  status          TicketStatus @default(OPEN)
  assignedAdminId String?  @map("assignedAdminId")
  resolvedAt      DateTime? @map("resolvedAt")
  createdAt       DateTime @default(now()) @map("createdAt")
  updatedAt       DateTime @updatedAt @map("updatedAt")

  customer        User     @relation("supportTickets", fields: [customerId], references: [id], onDelete: Cascade)
  order           Order?   @relation(fields: [orderId], references: [id], onDelete: SetNull)
  assignedAdmin   User?    @relation("assignedSupportTickets", fields: [assignedAdminId], references: [id], onDelete: SetNull)
  messages        SupportMessage[]

  @@index([customerId, status])
  @@index([assignedAdminId, status])
  @@index([orderId])
  @@map("support_ticket")
}
```

#### SupportMessage
```prisma
model SupportMessage {
  id          String   @id @default(cuid())
  ticketId    String   @map("ticketId")
  senderId    String   @map("senderId")
  content     String
  isAdminReply Boolean  @default(false) @map("isAdminReply")
  createdAt   DateTime @default(now()) @map("createdAt")

  ticket      SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  sender      User     @relation("sentSupportMessages", fields: [senderId], references: [id], onDelete: Cascade)

  @@index([ticketId, createdAt])
  @@index([senderId])
  @@map("support_message")
}
```

### Updated User Model Relations
```prisma
model User {
  // ... existing fields
  notifications         Notification[]
  sentOrderMessages     OrderMessage[]   @relation("sentOrderMessages")
  sentSupportMessages   SupportMessage[] @relation("sentSupportMessages")
  assignedSupportTickets SupportTicket[]  @relation("assignedSupportTickets")
  supportTickets        SupportTicket[]  @relation("supportTickets")
}
```

### Enums Added
```prisma
enum NotificationType {
  ORDER_CREATED
  ORDER_CANCELLED
  ORDER_STARTED
  ORDER_PROGRESS_UPDATED
  ORDER_COMPLETED
  ORDER_REOPENED
  BOOSTER_ASSIGNED
  BOOSTER_ACCEPTED
  BOOSTER_REJECTED
  BOOSTER_REASSIGNED
  BOOSTER_REMOVED
  BOOSTER_ABANDONED
  NEW_MESSAGE
  SUPPORT_REPLY
  SUPPORT_STATUS_UPDATED
  SUPPORT_TICKET_CREATED
  SUPPORT_TICKET_RESOLVED
}

enum TicketCategory {
  ORDER_ISSUE
  BOOSTER_ISSUE
  PAYMENT_ISSUE
  TECHNICAL_ISSUE
  ACCOUNT_ISSUE
  OTHER
}

enum TicketPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum TicketStatus {
  OPEN
  IN_PROGRESS
  WAITING_FOR_CUSTOMER
  RESOLVED
  CLOSED
}
```

## Event Catalog & Recipient Matrix

| Event Type | Trigger | Recipients |
|------------|---------|------------|
| `ORDER_CREATED` | Customer creates order | Customer, Admins |
| `ORDER_CANCELLED` | Order cancelled | Customer, Assigned Booster, Admins |
| `ORDER_STARTED` | Booster starts work | Customer, Admins |
| `ORDER_PROGRESS_UPDATED` | Progress update | Customer, Admins |
| `ORDER_COMPLETED` | Order marked complete | Customer, Assigned Booster, Admins |
| `ORDER_REOPENED` | Order reopened | Customer, Assigned Booster, Admins |
| `BOOSTER_ASSIGNED` | Booster assigned/claimed | Customer, Admins |
| `BOOSTER_ACCEPTED` | Booster accepts assignment | Customer, Admins |
| `BOOSTER_REJECTED` | Booster rejects assignment | Customer, Admins |
| `BOOSTER_REASSIGNED` | Order reassigned | Customer, New Booster, Old Booster, Admins |
| `BOOSTER_REMOVED` | Booster removed | Customer, Removed Booster, Admins |
| `BOOSTER_ABANDONED` | Booster abandons order | Customer, Admins |
| `NEW_MESSAGE` | New chat message | Other party in conversation |
| `SUPPORT_REPLY` | New support message | Ticket creator (if admin replies) or assigned admin |
| `SUPPORT_STATUS_UPDATED` | Ticket status changed | Ticket creator |
| `SUPPORT_TICKET_CREATED` | New support ticket | Admins |
| `SUPPORT_TICKET_RESOLVED` | Ticket resolved | Ticket creator |

## API Endpoints

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | List notifications (paginated) |
| PATCH | `/api/notifications/[id]` | Mark notification as read |
| POST | `/api/notifications/read-all` | Mark all notifications as read |

### Order Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders/[orderId]/messages` | Get messages (paginated) |
| POST | `/api/orders/[orderId]/messages` | Send message |

### Support Tickets
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/support/tickets` | List tickets (with filters) |
| POST | `/api/support/tickets` | Create ticket |
| GET | `/api/support/tickets/[ticketId]` | Get ticket details |
| PATCH | `/api/support/tickets/[ticketId]` | Update ticket (admin: status, assign) |
| GET | `/api/support/tickets/[ticketId]/messages` | Get ticket messages |
| POST | `/api/support/tickets/[ticketId]/messages` | Add message to ticket |

### Socket.io
| Event | Direction | Description |
|-------|-----------|-------------|
| `notification:new` | Server → Client | New notification received |
| `notification:count` | Server → Client | Unread count update |
| `message:new` | Server → Client | New order chat message |
| `support:message:new` | Server → Client | New support ticket message |
| `join:order` | Client → Server | Join order room |
| `leave:order` | Client → Server | Leave order room |
| `join:ticket` | Client → Server | Join ticket room |

## Authorization Rules

### Order Chat
- **Customer**: Can access chat for their own orders
- **Booster**: Can access chat only for currently assigned orders (status: ASSIGNED, ACCEPTED, IN_PROGRESS, PAUSED)
- **Admin**: Can access all order chats

### Support Tickets
- **Customer**: Can create tickets, view own tickets, add messages to own tickets
- **Admin**: Can view all tickets, update status, assign tickets, add messages to any ticket

### Notifications
- Users only see their own notifications
- Real-time delivery via Socket.io rooms (`user:{userId}`)

## Real-time Architecture

### Socket.io Server (`lib/socket/server.ts`)
- Authentication middleware validates JWT token from handshake auth
- Rooms: `user:{userId}`, `order:{orderId}`, `ticket:{ticketId}`
- Emit helpers: `emitNotification()`, `emitOrderMessage()`, `emitSupportMessage()`, `emitUnreadCount()`

### Socket.io Client (`lib/socket/client.tsx`)
- `useSocket()` hook manages connection lifecycle
- Auto-reconnect with exponential backoff
- Returns: `isConnected`, `notifications`, `unreadCount`, `orderMessages`, `supportMessages`, `joinOrder`, `leaveOrder`, `joinTicket`, `leaveTicket`

## Chat Lifecycle

1. **Conversation Creation**: Auto-created when first message sent or when order is claimed
2. **Access Control**: Verified on each message send/fetch via `canAccessConversation()`
3. **Real-time Delivery**: Messages emitted to `order:{orderId}` room
4. **Read Receipts**: `readAt` timestamp updated when messages viewed
5. **History**: Infinite scroll pagination (50 messages per page)

## Support Ticket Lifecycle

1. **Creation**: Customer creates ticket (optionally linked to order)
2. **Assignment**: Admin can assign ticket to themselves
3. **Status Transitions**: OPEN → IN_PROGRESS → WAITING_FOR_CUSTOMER → RESOLVED → CLOSED
4. **Communication**: Threaded messages between customer and admin
5. **Notifications**: Real-time updates for all parties

## Frontend Components

### Notifications
- `NotificationBell` - Dropdown with unread count, mark-as-read, pagination
- `NotificationCenter` - Full page view with all notifications

### Order Chat
- `OrderChat` - Real-time chat component with infinite scroll, send, read receipts
- Integrated into `OrderWorkspace` as tabbed interface (Info/Chat)

### Support
- `SupportTicketList` - Filterable, paginated ticket list
- `SupportTicketDetail` - Conversation view with admin actions
- Customer pages: `/dashboard/support`, `/dashboard/support/new`, `/dashboard/support/[ticketId]`
- Admin pages: `/dashboard/admin/support`, `/dashboard/admin/support/[ticketId]`

## Navigation Updates
- Added "Notifications" link (Bell icon) for all roles
- Added "Support" link (LifeBuoy icon) for Customer and Admin roles

## Implementation Files

### Services
- `lib/notifications/service.ts` - Centralized notification creation & event handling
- `lib/notifications/types.ts` - Event types, titles, messages, recipient rules
- `lib/chat/service.ts` - Conversation management, authorization, messaging
- `lib/support/service.ts` - Ticket CRUD, status transitions, assignments
- `lib/socket/server.ts` - Socket.io server with auth & rooms
- `lib/socket/client.tsx` - Client hook for real-time features

### API Routes
- `app/api/notifications/route.ts`
- `app/api/notifications/[id]/route.ts`
- `app/api/notifications/read-all/route.ts`
- `app/api/orders/[orderId]/messages/route.ts`
- `app/api/support/tickets/route.ts`
- `app/api/support/tickets/[ticketId]/route.ts`
- `app/api/support/tickets/[ticketId]/messages/route.ts`
- `app/api/socket/route.ts` - Socket.io initialization

### Components
- `components/notifications/NotificationBell.tsx`
- `components/notifications/NotificationCenter.tsx`
- `components/chat/OrderChat.tsx`
- `components/support/SupportTicketList.tsx`
- `components/support/SupportTicketDetail.tsx`

### Pages
- `app/dashboard/[orderId]/page.tsx` - Order detail with chat
- `app/dashboard/support/page.tsx` - Customer ticket list
- `app/dashboard/support/new/page.tsx` - Create ticket
- `app/dashboard/support/[ticketId]/page.tsx` - Ticket detail
- `app/dashboard/admin/support/page.tsx` - Admin ticket list
- `app/dashboard/admin/support/[ticketId]/page.tsx` - Admin ticket detail

## Test Results
- All new functionality compiles successfully (TypeScript clean)
- Build passes modulo pre-existing codebase issues
- Integration tests for assignment service pass with updated return types

## Known Limitations
1. Socket.io server runs in same process - not suitable for horizontal scaling without Redis adapter
2. No email/push notification fallback when user offline
3. Support ticket search limited to basic filters
4. No file attachment support in chat/tickets
5. Conversation read receipts only update on view, not per-message
6. Pre-existing TypeScript errors in codebase prevent full build success