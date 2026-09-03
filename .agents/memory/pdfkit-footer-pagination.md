---
name: PDFKit footer pagination
description: Preventing page footers from silently inflating PDFKit document page counts.
---

PDFKit footer text must be placed fully inside the page's printable area, and the content paginator must reserve that footer area. Text positioned below the bottom margin can silently create a new overflow page even when `lineBreak: false` is used.

**Why:** A buffered landscape export initially produced exactly three times the expected pages because each of two footer text calls added an overflow page below the printable boundary.

**How to apply:** Keep the footer baseline and font height above `page.height - bottomMargin`; use a stricter content-height threshold so tables cannot overlap it. After generation, verify the page count and render at least one page rather than checking only the PDF signature.