---
name: CARTO basemap API key
description: Current access requirement for the CARTO raster basemap used by the competitor map.
---

CARTO’s public raster basemap tiles now require a basemap API key. The key is intended to
be used client-side with the tile URL and should be restricted to the app’s domain.

**Why:** The previously public `basemaps.cartocdn.com` URL now renders an “API KEY
REQUIRED” watermark when the key is absent.

**How to apply:** If keeping CARTO, configure a domain-restricted client-side key through
the app’s environment configuration and append it as the tile URL’s `key` parameter.
Otherwise switch the map to a provider whose usage terms do not require this key.