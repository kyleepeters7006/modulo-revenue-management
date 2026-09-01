---
name: Large ExcelJS exports
description: Large tenant workbooks must use the streaming writer and temporary-file response path.
---

Use ExcelJS `WorkbookWriter` for large tenant-scoped exports; building a full in-memory workbook can exhaust the app process even when the resulting XLSX is a reasonable download size. Streaming worksheets write frozen-pane options at worksheet construction time, and the completed temporary file should be sent with a cleanup callback.

**Why:** The regular ExcelJS writer exhausted the Node heap on a multi-month tenant export, while the streaming writer completed successfully without the 502/OOM failure.

**How to apply:** For future large workbook downloads, avoid `writeBuffer()` and do not set streaming worksheet views after construction; pass them in `addWorksheet(name, { views })` and stream/send the resulting file.