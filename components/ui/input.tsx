import * as React from "react";
import { cn } from "@/lib/utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-lg border border-white/15 bg-[#111319] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Input };