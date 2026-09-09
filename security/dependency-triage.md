# Security scan triage

Reviewed 2026-09-09 after the local authentication and MFA changes.

## Scan results

- Dependency audit after compatible updates: 14 high, 6 moderate, and 1 low findings; 0 critical.
- Static analysis: one medium finding for SHA-1 in `server/security.ts`.
- Privacy/dataflow scan: no findings.

## Remediated

The following direct dependencies were upgraded to versions identified by the
audit as fixed or materially safer, and the production build still succeeds:

- `@anthropic-ai/sdk` → `0.91.1`
- `csv-parse` → `7.0.2`
- `sharp` → `0.35.4`
- `ws` → `8.20.1`

## Findings retained with rationale

- The SHA-1 use is the HMAC primitive required by the deployed
  standards-compatible six-digit TOTP profile (RFC 6238 / Google Authenticator
  interoperability). It is not used as a password hash, encryption primitive,
  or general integrity hash. Passwords and recovery codes use bcrypt, and MFA
  secrets use authenticated AES-256-GCM encryption.
- `xlsx` has no compatible upstream fix in the audit data. `pptxgenjs` and its
  `image-size` finding have no safe remediation that preserves the current
  export API; the audit's suggested downgrade is not compatible with the
  installed package line.
- `exceljs`/`uuid` remediation suggests downgrading `exceljs` to an old major
  version. That would remove features used by current workbook exports, so it
  is deferred to a separately tested export-library migration.
- `drizzle-orm` remediation requires a breaking 0.x upgrade. It is deferred
  until the schema/query suite can be run against the new release.
- Express, body-parser, qs, path-to-regexp, multer, and the remaining glob,
  minimatch, picomatch, brace-expansion, jws, lodash, gaxios, and yaml findings
  are transitive or require framework-major changes. They remain explicitly
  tracked for a compatibility upgrade rather than applying an untested
  broad dependency rewrite. Request body limits, security headers, CSP,
  server-side authorization, CSRF checks, and MFA step-up controls are active
  independently of that upgrade.

This is a dependency-risk triage record, not a certification or a claim that
the unresolved packages are risk-free.