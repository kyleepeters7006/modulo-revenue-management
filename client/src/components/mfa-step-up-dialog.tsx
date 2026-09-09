import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeMfaStepUp, MFA_STEP_UP_REQUIRED_EVENT } from "@/lib/queryClient";

export default function MfaStepUpDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const show = () => {
      setError("");
      setCode("");
      setOpen(true);
    };
    window.addEventListener(MFA_STEP_UP_REQUIRED_EVENT, show);
    return () => window.removeEventListener(MFA_STEP_UP_REQUIRED_EVENT, show);
  }, []);

  if (!open) return null;

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/mfa/step-up", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        setError("That authenticator code is not valid.");
        return;
      }
      completeMfaStepUp();
      setOpen(false);
      setCode("");
    } catch {
      setError("We could not verify the code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={verify} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-xl dark:bg-[var(--dashboard-surface)]">
        <div>
          <h2 className="text-lg font-semibold text-[var(--trilogy-dark-blue)]">Verify your identity</h2>
          <p className="mt-1 text-sm text-gray-600">This action needs a recent authenticator verification.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mfa-step-up-code">Authenticator code</Label>
          <Input
            id="mfa-step-up-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            required
          />
        </div>
        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <Button type="submit" disabled={submitting} className="w-full bg-[var(--trilogy-teal)] text-white">
          {submitting ? "Verifying..." : "Verify and continue"}
        </Button>
      </form>
    </div>
  );
}