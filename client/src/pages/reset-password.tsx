import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) return setMessage("Passwords do not match.");
    const response = await fetch("/api/auth/password-reset", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ token, password }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error || "This reset link is invalid or expired.");
    setDone(true);
  };
  return <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4"><section className="w-full max-w-md rounded-lg border bg-white p-6 shadow-sm"><h1 className="text-2xl font-semibold">Set your Modulo password</h1>{done ? <div className="space-y-4 pt-4"><p role="status">Your password was set. Sign in to enroll your authenticator.</p><Button onClick={() => setLocation("/")}>Continue to login</Button></div> : <form className="space-y-4 pt-4" onSubmit={submit}><input type="text" name="username" autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden="true" /><p className="text-sm text-gray-600">Choose at least 12 characters with a letter and a number.</p><div><Label htmlFor="reset-password">New password</Label><Input id="reset-password" data-testid="input-reset-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div><div><Label htmlFor="reset-password-confirm">Confirm password</Label><Input id="reset-password-confirm" data-testid="input-reset-password-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></div>{message && <p role="alert" className="text-sm text-red-600">{message}</p>}<Button type="submit" data-testid="button-reset-password">Set password</Button></form>}</section></main>;
}