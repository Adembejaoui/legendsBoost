"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Shield, ArrowRight } from "lucide-react";

export function BoosterWelcomeModal({
  user,
  boosterProfile,
}: {
  user: { id: string; name: string | null; email: string | null };
  boosterProfile: { id: string; userId: string; welcomeModalSeen: boolean } | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [markingSeen, setMarkingSeen] = useState(false);
  const [open, setOpen] = useState(true);

  const handleMarkSeen = async (navigateToBoosterDashboard: boolean) => {
    setMarkingSeen(true);
    try {
      const res = await fetch("/api/booster/welcome-modal/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        toast({
          title: "Could not dismiss welcome",
          description: "Please try again later.",
          type: "destructive",
        });
        return;
      }

      setOpen(false);
      if (navigateToBoosterDashboard) {
        router.push("/dashboard/booster");
      } else {
        toast({
          title: "Welcome aboard!",
          description: "Your booster account is now active.",
        });
      }
    } catch {
      toast({
        title: "Could not dismiss welcome",
        description: "Please try again later.",
        type: "destructive",
      });
    } finally {
      setMarkingSeen(false);
    }
  };

  if (!open || boosterProfile?.welcomeModalSeen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booster-welcome-title"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => handleMarkSeen(false)}
      />
      <div className="relative w-full max-w-md mx-4 rounded-xl border border-white/10 bg-[#111319] p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="size-6 text-violet-400" />
        <h2 id="booster-welcome-title" className="text-xl font-bold text-white">
          Welcome back, {user.name || "Booster"}
        </h2>
        </div>
        <p className="mb-6 text-sm text-zinc-300">
          Your booster account is now active. You can browse and claim available orders, manage your
          availability, and track your assignments from the booster dashboard.
        </p>
        <div className="flex gap-3">
          <Button
            onClick={() => handleMarkSeen(true)}
            disabled={markingSeen}
            className="flex-1"
          >
            {markingSeen ? "Going..." : "Go to Booster Dashboard"}
            <ArrowRight className="ml-2 size-4" />
          </Button>
          <Button variant="outline" onClick={() => handleMarkSeen(false)} disabled={markingSeen}>
            Maybe later
          </Button>
        </div>
        <p className="mt-4 text-xs text-zinc-500 text-center">
          This welcome is shown once. You can always reach the booster dashboard from the sidebar.
        </p>
      </div>
    </div>
  );
}
