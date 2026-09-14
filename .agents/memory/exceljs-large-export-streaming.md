---
name: Large ExcelJS exports
description: Large tenant workbooks must use the streaming writer and temporary-file response path.
---

Use ExcelJS `WorkbookWriter` for large tenant-scoped exports; building a full in-memory workbook can exhaust the app process even when the resulting XLSX is a reasonable download size. Streaming worksheets write frozen-pane options at worksheet construction time, and the completed temporary file should be sent with a cleanup callback.

**Why:** The regular ExcelJS writer exhausted the Node heap on a multi-month tenant export, while the streaming writer completed successfully without the 502/OOM failure.

**How to apply:** For future large workbook downloads, avoid `writeBuffer()` and do not set streaming worksheet views after construction; pass them in `addWorksheet(name, { views })` and stream/send the resulting file.

Long-running solver exports also need an asynchronous request boundary: start a
tenant-scoped export job, return its ID immediately, then let the browser poll
and download when ready.

**Why:** even a workbook that fits in memory can exceed the preview proxy's
single-request timeout when a full portfolio solve runs before serialization;
the browser reports only `Failed to fetch` and the server may never log a
completed request.

**How to apply:** keep jobs tenant-scoped with a short TTL, retry transient poll
disconnects, consume ready downloads once, and return explicit failed/expired
states.