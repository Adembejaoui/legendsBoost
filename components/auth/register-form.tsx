"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleIcon } from "@/components/auth/google-icon";
import { Field, PasswordInput, Spinner, inputClass } from "@/components/auth/auth-ui";

type Loading = "credentials" | "google" | null;
type FieldName = "name" | "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldName, string>>;

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["", "#f87171", "#fbbf24", "#C8AA6E", "#0AC8B9"];

function getStrength(pw: string) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) score++;
  return Math.max(score, 1);
}

function validate(values: Record<FieldName, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (!/^\S+@\S+\.\S+$/.test(values.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  if (values.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }
  if (values.confirmPassword !== values.password) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<Loading>(null);

  const busy = loading !== null;
  const strength = getStrength(password);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  function clearField(field: FieldName) {
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const errors = validate({ name, email, password, confirmPassword });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading("credentials");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Registration failed.");
        setLoading(null);
        return;
      }

      // Auto sign-in after successful registration.
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        router.push("/login");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  async function onGoogle() {
    setError(null);
    setLoading("google");
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch {
      setError("Google sign-in failed. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="w-full max-w-md">
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2.5 border-white/10 bg-white/[0.03] font-medium text-white hover:bg-white/[0.07] hover:text-white"
        disabled={busy}
        onClick={onGoogle}
      >
        {loading === "google" ? <Spinner /> : <GoogleIcon />}
        Continue with Google
      </Button>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-xs text-zinc-500">or sign up with email</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field id="name" label="Name" error={fieldErrors.name}>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="Your name"
            className={inputClass}
          />
        </Field>

        <Field id="email" label="Email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearField("email");
            }}
            disabled={busy}
            placeholder="you@example.com"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className={inputClass}
          />
        </Field>

        <Field id="password" label="Password" error={fieldErrors.password}>
          <PasswordInput
            id="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              clearField("password");
            }}
            disabled={busy}
            placeholder="At least 8 characters"
            invalid={!!fieldErrors.password}
            describedBy={
              [fieldErrors.password ? "password-error" : "", password ? "password-strength" : ""]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
          {password && (
            <div id="password-strength" className="flex items-center gap-3 pt-1">
              <div className="flex flex-1 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((seg) => (
                  <span
                    key={seg}
                    className="h-1 flex-1 rounded-full bg-white/10 transition-colors"
                    style={seg <= strength ? { backgroundColor: STRENGTH_COLORS[strength] } : undefined}
                  />
                ))}
              </div>
              <span className="w-12 text-right text-xs text-zinc-400">
                <span className="sr-only">Password strength: </span>
                {STRENGTH_LABELS[strength]}
              </span>
            </div>
          )}
        </Field>

        <Field id="confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
          <PasswordInput
            id="confirmPassword"
            value={confirmPassword}
            onChange={(v) => {
              setConfirmPassword(v);
              clearField("confirmPassword");
            }}
            disabled={busy}
            placeholder="Repeat password"
            invalid={!!fieldErrors.confirmPassword}
            describedBy={fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
          />
          {passwordsMatch && !fieldErrors.confirmPassword && (
            <p className="flex items-center gap-1.5 pt-1 text-xs text-[#0AC8B9]">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              Passwords match
            </p>
          )}
        </Field>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={busy}
          className="h-11 w-full gap-2 bg-[#C8AA6E] font-semibold text-[#0A0E14] hover:bg-[#d8bc85] focus-visible:ring-2 focus-visible:ring-[#C8AA6E]/40 disabled:opacity-70"
        >
          {loading === "credentials" ? (
            <>
              <Spinner />
              Creating account…
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-xs leading-relaxed text-zinc-500">
        By creating an account, you agree to our{" "}
        <Link href="/terms" className="text-zinc-300 underline-offset-4 hover:underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-zinc-300 underline-offset-4 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>

      <p className="mt-4 text-center text-sm text-zinc-400">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[#C8AA6E] underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}