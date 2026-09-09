import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LogIn, Loader2 } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
}

export default function LoginModal({ open, onClose }: LoginModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"credentials" | "challenge" | "setup" | "recovery">("credentials");
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");

  const loginMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Login failed");
      }
      return res.json();
    },
    onSuccess: async (data: any) => {
      if (data.mfaRequired) {
        setStage("challenge");
        return;
      }
      if (data.mfaSetupRequired) {
        const setupRes = await fetch("/api/auth/mfa/setup", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
        if (!setupRes.ok) {
          setError("MFA setup could not be started. Please try again.");
          return;
        }
        setSetup(await setupRes.json());
        setStage("setup");
        return;
      }
      queryClient.clear();
      window.location.reload();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const mfaMutation = useMutation({
    mutationFn: async ({ endpoint, code }: { endpoint: string; code: string }) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      return data;
    },
    onSuccess: (data: any) => {
      if (data.recoveryCodes) {
        setRecoveryCodes(data.recoveryCodes);
        setStage("recovery");
      } else {
        queryClient.clear();
        window.location.reload();
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (stage === "credentials") {
      loginMutation.mutate({ username, password });
    } else if (stage === "setup") {
      mfaMutation.mutate({ endpoint: "/api/auth/mfa/setup/confirm", code });
    } else {
      mfaMutation.mutate({ endpoint: "/api/auth/mfa/challenge", code });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md bg-white dark:bg-[var(--dashboard-surface)] border border-gray-200 dark:border-[var(--dashboard-border)]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-[var(--trilogy-dark-blue)]">
            {stage === "credentials" && "Client Login"}
            {stage === "challenge" && "Verify your identity"}
            {stage === "setup" && "Set up authenticator app"}
            {stage === "recovery" && "Save your recovery codes"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Enter your credentials to access your client environment.
          </DialogDescription>
        </DialogHeader>

        {stage === "recovery" ? (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-gray-600">
              Store these codes somewhere safe. They are shown only once and each code can be used one time.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-gray-50 border p-4 font-mono text-sm">
              {recoveryCodes.map((recoveryCode) => <span key={recoveryCode}>{recoveryCode}</span>)}
            </div>
            <Button type="button" onClick={() => { queryClient.clear(); window.location.reload(); }} className="w-full bg-[var(--trilogy-teal)] text-white">
              Continue to Modulo
            </Button>
          </div>
        ) : <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {stage === "credentials" ? <>
          <div className="space-y-1">
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">
              Username
            </Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              disabled={loginMutation.isPending}
              className="border-gray-300 focus:border-[var(--trilogy-teal)]"
              required
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password" className="text-sm font-medium text-gray-700">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={loginMutation.isPending}
              className="border-gray-300 focus:border-[var(--trilogy-teal)]"
              required
            />
          </div>
          </> : stage === "setup" ? <>
            <p className="text-sm text-gray-600">
              Scan this QR code with Google Authenticator, 1Password, Microsoft Authenticator, or another TOTP app.
            </p>
            {setup?.qrCode && <img src={setup.qrCode} alt="Authenticator enrollment QR code" className="mx-auto h-56 w-56 rounded border p-2" />}
            <p className="text-center text-xs text-gray-500 break-all">Can’t scan? Enter this key manually: <strong>{setup?.secret}</strong></p>
            <div className="space-y-1">
              <Label htmlFor="mfa-setup-code">6-digit code</Label>
              <Input id="mfa-setup-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} required />
            </div>
          </> : <>
            <p className="text-sm text-gray-600">Enter the 6-digit code from your authenticator app. You may enter a recovery code instead.</p>
            <div className="space-y-1">
              <Label htmlFor="mfa-code">Authenticator or recovery code</Label>
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456 or XXXXX-XXXXX" required autoFocus />
            </div>
          </>}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loginMutation.isPending || mfaMutation.isPending}
            className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          >
            {loginMutation.isPending || mfaMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4 mr-2" />
                {stage === "credentials" ? "Sign In" : stage === "setup" ? "Confirm enrollment" : "Verify and continue"}
              </>
            )}
          </Button>

          <p className="text-xs text-center text-gray-500">
            {stage === "credentials" ? "Please log in to access your data. Demo mode is available without login." : "Your password is verified before this additional factor is requested."}
          </p>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
