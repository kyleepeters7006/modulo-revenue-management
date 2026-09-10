---
name: MatrixCare label recovery
description: Historical MatrixCare source files are not retained in upload metadata, so label repairs require an operator-supplied original workbook.
---

Historical rent-roll uploads record the filename and counts in `upload_history`, but not the original workbook bytes. The safe recovery path must therefore accept the original MatrixCare file, scope by owning client and upload month, fill only missing destination labels, and report unresolved identities instead of inferring them.

**Why:** Older imports lost product descriptors, while the source files may still exist in the workspace or operator archives. Applying a workbook outside its tenant/month can silently corrupt historical product classification.

**How to apply:** Keep recovery dry-run by default, require an admin or internal seed-secret authorization, and preserve the source row identity and unresolved reason in the result. Legacy rows may store only the room prefix before `/`; use that fallback only when all source beds agree on labels.