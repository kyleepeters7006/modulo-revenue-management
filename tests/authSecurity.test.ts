import assert from "node:assert/strict";
import {
  compareRecoveryCode,
  createRecoveryCodes,
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  ProgressiveThrottle,
  totpCode,
  verifyTotp,
} from "../server/security";

async function main() {
  const secret = createTotpSecret();
  const now = 1_735_689_600_000;
  const generated = totpCode(secret, now);
  assert.equal(verifyTotp(secret, generated.code, null, now), generated.step);
  assert.equal(
    verifyTotp(secret, generated.code, generated.step, now),
    null,
    "a TOTP step cannot be replayed",
  );
  assert.equal(verifyTotp(secret, "000000", null, now), null);

  const encrypted = encryptSecret(secret);
  assert.equal(decryptSecret(encrypted), secret, "MFA secrets round-trip through authenticated encryption");
  assert.notEqual(encrypted, secret, "the stored MFA value is not plaintext");

  const [recoveryCode] = createRecoveryCodes(1);
  const recoveryHash = await hashRecoveryCode(recoveryCode);
  assert.equal(await compareRecoveryCode(recoveryCode, recoveryHash), true);
  assert.equal(await compareRecoveryCode("WRONG-WRONG", recoveryHash), false);

  const throttle = new ProgressiveThrottle();
  assert.equal(throttle.isBlocked("ip:test"), false);
  const firstDelay = throttle.recordFailure("ip:test");
  assert.equal(throttle.isBlocked("ip:test"), true);
  const secondDelay = throttle.recordFailure("ip:test");
  assert.ok(secondDelay > firstDelay, "repeated failures increase the delay");
  throttle.clear("ip:test");
  assert.equal(throttle.isBlocked("ip:test"), false);

  console.log("6 passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});