---
name: Playwright browser on Nix
description: How to run Playwright browser specs when the bundled headless shell lacks shared libraries.
---

When Playwright's downloaded Chromium fails before launch with a missing shared
library such as `libglib-2.0.so.0`, look for a system Chromium and pass its
path through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; the repository's
playwright config already honors that variable.

**Why:** The bundled browser can be present but unusable in the Nix runtime,
while the system browser has the libraries needed to run the same spec.

**How to apply:** Check `command -v chromium` or the Nix store, set the
executable-path environment variable for the focused Playwright command, and
do not treat the bundled-browser launch error as an application failure.