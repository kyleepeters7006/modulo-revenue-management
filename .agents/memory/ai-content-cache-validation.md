---
name: AI-generated content must pass a usability check before being cached
description: Why AI commentary/summary panels go blank for long stretches, and the rule that prevents it — validate semantic content, not just parseability, at every cache boundary.
---

# Validate AI output before caching it

Any AI-generated panel that is persisted to a cache table must pass a **semantic** usability
check before it is served or stored. Parseability is not the bar.

**The rule:** a payload is usable only if it has non-empty prose OR at least one populated
item. Apply the same predicate at three boundaries:

1. Right after parsing the model response — an unusable result is a *failed attempt*, so the
   retry and any deterministic fallback actually get a chance to run.
2. Before serving a row read back from the cache — a blank row written by an older build
   must be discarded and regenerated, not handed to the client.
3. Before writing to the cache — never persist a degraded result. Give it a short
   memory-only TTL instead so the next request retries.

**Why:** the two failure shapes look nothing alike but produce the same blank UI, and only
one of them is obvious:

- The model returns something unparseable, and a `try { ... } catch { parsed = {} }` swallows
  it into an empty object.
- The model returns **valid JSON that is semantically empty** (`{"summary":"","rules":[]}`).
  This is the one that bites, because every "did it parse?" guard waves it through.

Either way the empty payload gets written to the persistent cache with the normal long TTL.
Stale-while-revalidate then amplifies it: the blank row is served immediately on every
request, so one transient model hiccup becomes a panel that stays empty for the entire TTL
and looks like a hard bug rather than a blip. Users report it as "not loading".

**Also:** back the AI with a deterministic fallback built from data already in hand (the rows
that were fed to the prompt). A panel that degrades to plain, factual content is strictly
better than one that goes blank, and it means the failure path is never user-visible as an
error state.

**How to apply:** whenever adding or touching an endpoint that caches model output —
especially one with a persistent cache table plus stale-while-revalidate. Also check the
empty-state copy on the client: a message like "add some X to generate insights" is actively
misleading when the user already has X and generation simply failed. Distinguish "nothing to
show yet" from "generation failed, retry".
