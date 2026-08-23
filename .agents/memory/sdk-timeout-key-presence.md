---
name: SDK options are validated by key presence, not value
description: Why an optional setting must be omitted from a provider SDK's request options rather than spread in as undefined.
---

Provider SDK clients (the OpenAI and Anthropic node clients both do this) guard
optional request options with checks of the form `if ('key' in options)`. The
guard tests the **key's presence, not its value**, so spreading an optional
setting in as `undefined` fails validation — and fails at request-build time,
before any network call, which looks nothing like a provider outage.

**Rule:** never spread a possibly-absent value into SDK request options. Omit the
key entirely unless there is a valid value to send.

**Why:** a shared router builds one options object for every provider it fans out
to, so a single bad option takes down the primary AND its fallback together. The
fallback that exists to protect availability can never engage, and a whole
feature fails in a way that reads as "the model provider is down".
