import { useState } from "react";
import { AlertTriangle, LogIn } from "lucide-react";
import LoginModal from "@/components/login-modal";
import { useSessionExpired } from "@/lib/sessionExpiry";

/**
 * App-wide notice for a session that stopped revalidating.
 *
 * Without it, the server's 401 lands in whatever panel happened to be loading
 * and the rest of the page keeps its stale content, so the user sees scattered
 * blanks and no explanation. The notice states the cause once, for the whole
 * app, and offers the only action that fixes it.
 *
 * Palette is literal rather than `dark:`-prefixed: the app is wrapped in a
 * permanently-on `.dark` container, so a dark variant would paint here always.
 */
export default function SessionExpiredNotice() {
  const expired = useSessionExpired();
  const [showLogin, setShowLogin] = useState(false);

  if (!expired) return null;

  return (
    <>
      <div
        role="alert"
        className="relative z-[60] flex flex-wrap items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm text-white shadow-md"
        data-testid="banner-session-expired"
      >
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        <span>
          <strong>Your session has ended.</strong> Sign in again to load your data — anything
          still on screen is left over from before and is no longer being updated.
        </span>
        <button
          onClick={() => setShowLogin(true)}
          className="inline-flex items-center gap-1.5 rounded bg-white/20 px-2.5 py-1 font-semibold underline hover:bg-white/30 hover:no-underline"
          data-testid="button-session-expired-login"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in again
        </button>
      </div>
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
