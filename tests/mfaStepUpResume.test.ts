import assert from "node:assert/strict";
import {
  completeMfaStepUp,
  installMfaFetchGuard,
} from "../client/src/lib/queryClient";

async function main() {
  const calls: Array<string | URL | Request> = [];
  let first = true;
  const fakeWindow = {
    fetch: async (input: string | URL | Request) => {
      calls.push(input);
      if (first) {
        first = false;
        return new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED" }), { status: 428 });
      }
      return new Response("ok", { status: 200 });
    },
    dispatchEvent: () => {
      completeMfaStepUp();
      return true;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  const restore = installMfaFetchGuard();
  try {
    const response = await fakeWindow.fetch("/api/manual-rate-override");
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2, "the protected request resumes after step-up");
  } finally {
    restore();
    delete (globalThis as any).window;
  }
  console.log("1 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});