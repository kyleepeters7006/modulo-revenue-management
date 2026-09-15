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
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"credentials" | "challenge" | "setup" | "recovery" | "forgot" | "mfa-reset">("credentials");
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  const forgotMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identifier: username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to request a reset");
      return data;
    },
    onSuccess: (data) => setError(data.message || "If an account matches those details, a password reset link has been sent."),
    onError: (err: Error) => setError(err.message),
  });

  const mfaResetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/password-reset/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, code, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unable to reset the password");
      return data;
    },
    onSuccess: (data) => {
      setNotice(data.message || "If the account and verification code are valid, the password has been reset.");
      setPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setCode("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");
    if (stage === "credentials") {
      loginMutation.mutate({ username, password });
    } else if (stage === "forgot") {
      forgotMutation.mutate();
    } else if (stage === "mfa-reset") {
      if (newPassword !== confirmPassword) {
        setError("The new passwords do not match.");
        return;
      }
      mfaResetMutation.mutate();
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
            {stage === "forgot" && "Forgot password"}
            {stage === "mfa-reset" && "Reset with authenticator"}
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
          </> : stage === "forgot" ? <>
            <p className="text-sm text-gray-600">Enter your username or email. If an account matches, we’ll send a one-time reset link.</p>
            <div className="space-y-1">
              <Label htmlFor="forgot-identifier">Username or email</Label>
              <Input id="forgot-identifier" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
          </> : stage === "mfa-reset" ? <>
            <p className="text-sm text-gray-600">
              Enter your username, a current code from your enrolled authenticator, and a new password.
            </p>
            <div className="space-y-1">
              <Label htmlFor="mfa-reset-username">Username</Label>
              <Input id="mfa-reset-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-reset-code">6-digit authenticator code</Label>
              <Input id="mfa-reset-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} pattern="[0-9]{6}" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-reset-password">New password</Label>
              <Input id="mfa-reset-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
              <p className="text-xs text-gray-500">At least 12 characters, including a letter and a number.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mfa-reset-confirm">Confirm new password</Label>
              <Input id="mfa-reset-confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={12} required />
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
          {notice && (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {notice}
            </p>
          )}

          <Button
            type="submit"
            disabled={loginMutation.isPending || mfaMutation.isPending || forgotMutation.isPending || mfaResetMutation.isPending}
            className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          >
            {loginMutation.isPending || mfaMutation.isPending || forgotMutation.isPending || mfaResetMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4 mr-2" />
                {stage === "credentials" ? "Sign In" : stage === "forgot" ? "Send reset link" : stage === "mfa-reset" ? "Verify and reset password" : stage === "setup" ? "Confirm enrollment" : "Verify and continue"}
              </>
            )}
          </Button>

          {stage === "credentials" && <button type="button" className="w-full text-center text-xs text-[var(--trilogy-teal)] underline" onClick={() => { setError(""); setStage("forgot"); }}>Forgot password?</button>}
          {stage === "forgot" && <button type="button" className="w-full text-center text-xs text-[var(--trilogy-teal)] underline" onClick={() => { setError(""); setNotice(""); setStage("mfa-reset"); }}>Reset with authenticator instead</button>}
          {stage === "mfa-reset" && <button type="button" className="w-full text-center text-xs text-[var(--trilogy-teal)] underline" onClick={() => { setError(""); setNotice(""); setStage("forgot"); }}>Use email reset instead</button>}
          {stage === "forgot" && <button type="button" className="w-full text-center text-xs text-[var(--trilogy-teal)] underline" onClick={() => { setError(""); setStage("credentials"); }}>Back to sign in</button>}
          {stage === "mfa-reset" && <button type="button" className="w-full text-center text-xs text-[var(--trilogy-teal)] underline" onClick={() => { setError(""); setNotice(""); setStage("credentials"); }}>Back to sign in</button>}
          <p className="text-xs text-center text-gray-500">
            {stage === "credentials" || stage === "forgot" || stage === "mfa-reset" ? "Please log in to access your data. Demo mode is available without login." : "Your password is verified before this additional factor is requested."}
          </p>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
