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
type FieldErrors = { email?: string; password?: string };

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<Loading>(null);

  const busy = loading !== null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = "Enter your email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading("credentials");

    try {
      const result = await signIn("credentials", {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setLoading(null);
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
        <span className="text-xs text-zinc-500">or sign in with email</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field id="email" label="Email" error={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
            }}
            disabled={busy}
            placeholder="you@example.com"
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            className={inputClass}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          error={fieldErrors.password}
          action={
            <Link
              href="/forgot-password"
              className="text-xs text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
            }}
            disabled={busy}
            placeholder="Your password"
            invalid={!!fieldErrors.password}
            describedBy={fieldErrors.password ? "password-error" : undefined}
            autoComplete="current-password"
          />
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
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        New to LegendsBoost?{" "}
        <Link
          href="/register"
          className="font-medium text-[#C8AA6E] underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}