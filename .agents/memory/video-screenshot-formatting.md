---
name: Product demo screenshot formatting
description: How to keep application screenshots readable and fully contained in polished 16:9 demo videos
---

Capture the application at a browser zoom below 100% when a viewport screenshot cuts off important page context. Then fit that capture inside a fixed 16:9 card with explicit margins; do not try to reveal more UI by scaling an already-cropped image. Keep chapter labels outside the page image, and animate the cursor separately from the static trace.

**Why:** Scaling in the video editor only changes the size of the cropped viewport; it cannot restore content that was outside the original screenshot. Overlaid titles and static cursor graphics also obscure the product surface.

**How to apply:** For future product demos, recapture key pages at roughly 75–80% browser zoom, preserve the screenshot aspect ratio, add a consistent border/margin system, and render cursor movement as a separate overlay.

For tenant-specific captures, complete the normal password and MFA flow and verify both the tenant label and absence of the demo banner before saving any frame. Keep the authenticated browser context alive, or save its storage state, until every slow page has finished loading.

**Why:** Authenticator codes are replay-protected and cannot be reused after closing the capture session. A fixed sleep can also preserve a page shell while slow KPI and chart requests are still loading.

**How to apply:** Prefer the account's Base32 setup key when authorized; otherwise use a fresh one-time code immediately. Wait for page-specific loaded content, not just navigation or a timer, and never replace a failed Trilogy login with demo-mode screenshots.