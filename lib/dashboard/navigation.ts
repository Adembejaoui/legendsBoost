import {
  LayoutDashboard,
  Package,
  History,
  User,
  Gamepad2,
  ClipboardList,
  Clock,
  Calendar,
  Shield,
  Users,
  Settings,
  Wallet,
} from "lucide-react";

export type UserRole = "ADMIN" | "BOOSTER" | "CUSTOMER";

export interface DashboardNavItem {
  id: string;
  label: string;
  href: string;
  icon: string;
  description?: string;
  section?: string;
}

export const iconMap: Record<string, any> = {
  LayoutDashboard,
  Package,
  History,
  User,
  Gamepad2,
  ClipboardList,
  Clock,
  Calendar,
  Shield,
  Users,
  Settings,
  Wallet,
};

export const navigationByRole: Record<UserRole, DashboardNavItem[]> = {
  CUSTOMER: [
    { id: "customer-overview", label: "Overview", href: "/dashboard/customer", icon: "LayoutDashboard" },
    { id: "customer-orders", label: "My Orders", href: "/dashboard/customer", icon: "Package" },
    { id: "customer-history", label: "Order History", href: "/dashboard/customer?tab=completed", icon: "History" },
    { id: "customer-become-booster", label: "Become a Booster", href: "/dashboard/customer/become-booster", icon: "User" },
    { id: "customer-profile", label: "My Profile", href: "/dashboard/customer/profile", icon: "User" },
    { id: "customer-browse", label: "Browse Games", href: "/games", icon: "Gamepad2" },
  ],
  BOOSTER: [
    {
      id: "overview",
      label: "Overview",
      href: "/dashboard/booster",
      icon: "LayoutDashboard",
    },
    {
      id: "available-orders",
      label: "Available Orders",
      href: "/dashboard/booster/available-orders",
      icon: "ClipboardList",
    },
    {
      id: "claimed-orders",
      label: "Claimed Orders",
      href: "/dashboard/booster/claimed-orders",
      icon: "Package",
    },
    {
      id: "profile",
      label: "Profile",
      href: "/dashboard/booster/profile",
      icon: "User",
    },
    {
      id: "cashout",
      label: "Cashout",
      href: "/dashboard/booster/cashout",
      icon: "Wallet",
    },
  ],
  ADMIN: [
    { id: "admin-overview", label: "Overview", href: "/dashboard/admin", icon: "LayoutDashboard" },
    { id: "admin-applications", label: "Booster Applications", href: "/dashboard/admin/applications", icon: "ClipboardList" },
    { id: "admin-orders", label: "Orders", href: "/dashboard/admin/orders", icon: "Package" },
    { id: "admin-users", label: "Users", href: "/dashboard/admin/users", icon: "Users" },
    { id: "admin-boosters", label: "Boosters", href: "/dashboard/admin/boosters", icon: "Shield" },
    { id: "admin-settings", label: "Settings", href: "/dashboard/admin/settings", icon: "Settings" },
  ],
};

export function getNavigation(role: UserRole) {
  return navigationByRole[role] ?? [];
}
