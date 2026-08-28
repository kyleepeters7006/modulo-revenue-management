---
name: Ultra-wide hero image zoom
description: Why changing banner height or object position cannot truly zoom out a standard-aspect photo inside an edge-to-edge panoramic hero.
---

For a shallow, full-width hero, `object-cover` always scales a normal photo to
the container width and crops the excess height. Changing the container height
or `object-position` changes the crop, but it does not make the subject smaller.

**Why:** A requested “zoom out” initially changed only the banner height and
looked effectively unchanged. The source image and ultra-wide banner had
incompatible aspect ratios, so CSS could not both show more of the scene and
keep the image edge-to-edge.

**How to apply:** When the subject must become smaller while a shallow hero
still spans the page, create or use a panoramic source asset composed for that
aspect ratio. Give the wrapper the same aspect ratio as the asset. If a newly
added public asset was previously requested before it existed, change the URL
version to bypass a cached missing response.