---
name: Claude via Replit AI Integrations
description: How Claude calls are billed and constrained in this project
---

**Rule:** Claude calls go through Replit AI Integrations (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`/`_API_KEY`, billed to the Replit/enterprise account), not a personal `ANTHROPIC_API_KEY`. Never ask the user for an Anthropic key.

**Why:** User explicitly requires embedded AI keys charged to the enterprise account (July 2026). An earlier secret request for ANTHROPIC_API_KEY was rejected for this reason.

**How to apply:** aiRouter prefers the AI-integrations client; model is `claude-sonnet-4-6`. Do NOT pass `temperature`/`top_p`/`top_k` to Anthropic messages via the integration — newer Claude models 400 on non-default values. GPT fallback remains if no Anthropic client is available.
