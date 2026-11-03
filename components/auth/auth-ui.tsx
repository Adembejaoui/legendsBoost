"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export const inputClass =
  "h-11 border-white/10 bg-white/[0.03] text-white placeholder:text-zinc-600 " +
  "focus-visible:border-[#C8AA6E]/70 focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/20 " +
  "aria-[invalid=true]:border-red-400/60 aria-[invalid=true]:ring-red-400/20";

export function Field({
  id,
  label,
  error,
  action,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-sm font-medium text-zinc-300">
          {label}
        </Label>
        {action}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
  describedBy,
  autoComplete = "new-password",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder: string;
  invalid: boolean;
  describedBy?: string;
  autoComplete?: "new-password" | "current-password";
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={`${inputClass} pr-11`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9" />
              <path d="M6.6 6.7C4 8.4 2.5 12 2.5 12S6 18 12 18c1.5 0 2.8-.4 4-.9" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </>
          ) : (
            <>
              <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}