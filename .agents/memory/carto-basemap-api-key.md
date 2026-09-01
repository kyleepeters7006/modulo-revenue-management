---
name: CARTO basemap API key
description: Current access requirement for the CARTO raster basemap used by the competitor map.
---

CARTO’s public raster basemap tiles now require a basemap API key. The competitor map
uses Esri World Imagery instead, so satellite context does not depend on a new app key.

**Why:** The previously public `basemaps.cartocdn.com` URL now renders an “API KEY
REQUIRED” watermark when the key is absent.

**How to apply:** If CARTO is restored, configure a domain-restricted client-side key
through the app’s environment configuration and append it as the tile URL’s `key`
parameter. If the satellite layer changes, preserve visible provider attribution and
keep any visual filter scoped to tiles so markers stay vivid.