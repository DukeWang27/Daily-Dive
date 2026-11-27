# AI answer validation: pricing and latency of low-cost LLM APIs

Research date: 27 Nov 2026. Workload: one call per validation. About 600 input tokens go in (eligibility rules, the player's answer and an optional evidence snippet) and about 120 output tokens come out (a small JSON verdict).

## How far to trust these figures

| Status | Meaning |
|---|---|
| **VERIFIED** | Read from the provider's official page during this session. The URL and date are given. |
| **OFFICIAL (snippet)** | Text from an official page, but only as a web-search excerpt. The page itself could not be fetched. |
| **UNVERIFIED** | Third-party trackers or blogs only, or official sources that disagree. Check before you rely on it. |

**Access problem:** in this session `platform.openai.com`, `developers.openai.com`, `openai.com`, `ai.google.dev` and `api-docs.deepseek.com` all failed DNS resolution ("host outside the session's allowed network domains"). Only Anthropic's docs (`platform.claude.com`) could be fetched. Every OpenAI, Google, DeepSeek and Groq price below therefore comes from web search. Re-check those four official pricing pages (links in the per-provider sections) before committing to a budget.

---

## 1. Price summary (per 1M tokens, standard/on-demand tier)

| Provider / model | Input | Output | Cached input | Batch | Status |
|---|---:|---:|---:|---|---|
| **Anthropic Claude Haiku 5.5** (`claude-haiku-5-5`, prompts up to 100K tokens) | $0.10 | $0.50 | $0.01 read; $0.125 write (5 min); $0.20 write (1 h) | 50% off: $0.05 / $0.25 | VERIFIED |
| **Anthropic Claude Sonnet 5.5** (`claude-sonnet-5-5`) | $2.00 | $10.00 | $0.10 read (0.05x); $2.50 write (5 min); $4 write (1 h) | 50% off: $1 / $5 | VERIFIED |
| Anthropic Claude Haiku 4.5 (previous generation, for reference) | $1.00 | $5.00 | $0.10 read | $0.50 / $2.50 | VERIFIED |
| OpenAI GPT-5 nano | $0.05 | $0.40 | $0.005 | about 50% off: $0.025 / $0.20 | UNVERIFIED (search snippet attributed to developers.openai.com model page) |
| OpenAI GPT-5.4 nano (newer nano) | $0.20 | $1.25 | $0.02 | about 50% off; Flex reportedly the same as Batch | UNVERIFIED (third-party trackers) |
| OpenAI GPT-5 mini | $0.25 | $2.00 | $0.025 | $0.125 / $1.00 | UNVERIFIED |
| Google Gemini 3.5 Flash-Lite | $0.30 (sources conflict: $0.25–0.30) | $2.50 (sources conflict: $1.25–2.50) | not confirmed | 50% off (Batch and Flex) | UNVERIFIED (official page only partly seen in a snippet; output $2.50 appeared there) |
| Google Gemini 3.8 Flash | $0.375 (Vertex lists $0.75 introductory until 31 Dec 2026) | $1.875 (Vertex: $3.75) | $0.0375 | 50% off | UNVERIFIED (snippets disagree) |
| DeepSeek V4-Flash (`deepseek-v4-flash`) | $0.14 (cache miss) | $0.28 | $0.0028 (cache hit) | none published | UNVERIFIED (official page seen only as a snippet; InfoWorld reports a later rise to $0.22–0.44 / $0.66–1.32 with peak/off-peak pricing) |
| Groq gpt-oss-20b | $0.075 (Groq page snippet: $0.10) | $0.30 (snippet: $0.50) | n/a | Groq advertises a batch discount | UNVERIFIED |
| Groq Llama 3.1 8B Instant | $0.05 | $0.08 | n/a | — | UNVERIFIED |

Anthropic sources: <https://platform.claude.com/docs/en/about-claude/pricing> (read 27 Nov 2026). It also states that the Batch API takes 50% off input and output, that caching and batch discounts stack, and that Claude 4.7+ models (Haiku 5.5 and Sonnet 5.5 included) use a newer tokenizer that "produces approximately 30% more tokens for the same text". **Measure your real token counts with `count_tokens`.** A "600-token" prompt measured on another tokenizer may come out nearer 780 on Claude.

Official pages to re-check for the others:
- OpenAI: <https://platform.openai.com/docs/pricing> / <https://developers.openai.com/api/docs/pricing>
- Google: <https://ai.google.dev/gemini-api/docs/pricing>
- DeepSeek: <https://api-docs.deepseek.com/quick_start/pricing>
- Groq: <https://groq.com/pricing>

---

## 2. Cost per validation and per 1,000 validations

Assumes 600 input and 120 output tokens, no caching, standard tier, and **no thinking or reasoning tokens** (see section 4: reasoning tokens are billed as output and can multiply cost).

| Model | $/call | $/1,000 validations |
|---|---:|---:|
| Claude Haiku 5.5 (verified) | $0.000120 | **$0.12** |
| Claude Sonnet 5.5 (verified) | $0.002400 | $2.40 |
| Claude Haiku 4.5 (verified, reference) | $0.001200 | $1.20 |
| OpenAI GPT-5 nano (unverified) | $0.000078 | $0.08 |
| OpenAI GPT-5.4 nano (unverified) | $0.000270 | $0.27 |
| OpenAI GPT-5 mini (unverified) | $0.000390 | $0.39 |
| Gemini 3.5 Flash-Lite (unverified) | $0.000480 | $0.48 |
| Gemini 3.8 Flash (unverified, non-intro price) | $0.000450 | $0.45 |
| DeepSeek V4-Flash (unverified) | $0.000118 | $0.12 |
| Groq gpt-oss-20b (unverified) | $0.000081 | $0.08 |
| Groq Llama 3.1 8B Instant (unverified) | $0.000040 | $0.04 |

## 3. Monthly cost by player count and AI fraction F

AI calls per month = daily players × 15 guesses × F × 30 days.

| Daily players | F = 1% | F = 3% | F = 8% |
|---:|---:|---:|---:|
| 100 | 450 | 1,350 | 3,600 |
| 1,000 | 4,500 | 13,500 | 36,000 |
| 10,000 | 45,000 | 135,000 | 360,000 |
| 100,000 | 450,000 | 1,350,000 | 3,600,000 |

Monthly USD:

| Model | 100 @1% | 100 @3% | 100 @8% | 1k @1% | 1k @3% | 1k @8% | 10k @1% | 10k @3% | 10k @8% | 100k @1% | 100k @3% | 100k @8% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Claude Haiku 5.5** | $0.05 | $0.16 | $0.43 | $0.54 | $1.62 | $4.32 | $5.40 | $16.20 | $43.20 | $54 | $162 | $432 |
| Claude Sonnet 5.5 | $1.08 | $3.24 | $8.64 | $10.80 | $32.40 | $86.40 | $108 | $324 | $864 | $1,080 | $3,240 | $8,640 |
| Claude Haiku 4.5 | $0.54 | $1.62 | $4.32 | $5.40 | $16.20 | $43.20 | $54 | $162 | $432 | $540 | $1,620 | $4,320 |
| GPT-5 nano* | $0.04 | $0.11 | $0.28 | $0.35 | $1.05 | $2.81 | $3.51 | $10.53 | $28.08 | $35 | $105 | $281 |
| GPT-5.4 nano* | $0.12 | $0.36 | $0.97 | $1.22 | $3.65 | $9.72 | $12.15 | $36.45 | $97.20 | $122 | $364 | $972 |
| GPT-5 mini* | $0.18 | $0.53 | $1.40 | $1.76 | $5.27 | $14.04 | $17.55 | $52.65 | $140 | $176 | $526 | $1,404 |
| Gemini 3.5 Flash-Lite* | $0.22 | $0.65 | $1.73 | $2.16 | $6.48 | $17.28 | $21.60 | $64.80 | $173 | $216 | $648 | $1,728 |
| Gemini 3.8 Flash* | $0.20 | $0.61 | $1.62 | $2.03 | $6.07 | $16.20 | $20.25 | $60.75 | $162 | $202 | $608 | $1,620 |
| DeepSeek V4-Flash* | $0.05 | $0.16 | $0.42 | $0.53 | $1.59 | $4.23 | $5.29 | $15.88 | $42.34 | $53 | $159 | $423 |
| Groq gpt-oss-20b* | $0.04 | $0.11 | $0.29 | $0.36 | $1.09 | $2.92 | $3.65 | $10.94 | $29.16 | $36 | $109 | $292 |
| Groq Llama 3.1 8B* | $0.02 | $0.05 | $0.14 | $0.18 | $0.53 | $1.43 | $1.78 | $5.35 | $14.26 | $18 | $53 | $143 |

\* Unverified prices; see section 1.

**F falls over time.** Each AI verdict is stored against (question id, normalized answer). Later players who type the same answer hit the verdict cache instead of the API. The spread of distinct wrong-but-plausible answers to one question is narrow, so most AI calls come early in a question's life. F should drop well below its launch value as the cache fills, especially for questions that are replayed or shared by many players on the same day. The 8% column is a pessimistic launch-day figure; steady state is more likely near the 1% column. Log cache hits so you can measure the real F.

### Effect of the levers (Claude Haiku 5.5)

- **Prompt caching:** the shared prefix (system rules plus the day's question rules) can be cached if it is at least the model's minimum cacheable length. The skill reference gives 512 tokens for Haiku 5.5; confirm in the docs. A cache read costs $0.01/M instead of $0.10/M. With 600 input tokens the whole input costs only $0.06 per 1,000 calls, so caching saves at most about 45% of the bill. Most of what remains is output. Worth enabling, but not essential.
- **Batch API (50% off):** not suitable for live guesses. Results are asynchronous (Anthropic says most batches finish within an hour; up to 24 h). Use it only to pre-validate an alias list overnight.
- **Thinking off:** the largest hidden cost lever; see the next section.

---

## 4. Per-provider details

### Anthropic: Claude Haiku 5.5 / Sonnet 5.5 (VERIFIED, platform.claude.com, 27 Nov 2026)

- **Prices:** see the table above. Haiku 5.5 has a second rate card ($0.50 / $2.50) for prompts over 100K tokens, which does not apply here. A US-only `inference_geo` adds a 1.1x multiplier; the default (global) is standard price.
- **Thinking default (important for cost and latency):** Haiku 5.5 and Sonnet 5.5 run adaptive thinking **by default**. Thinking tokens are billed as output and delay the answer.
  - Haiku 5.5: send `thinking: {"type": "disabled"}`, which is accepted at effort `low`/`medium`/`high`, or use `output_config.effort: "low"`.
  - Sonnet 5.5: `disabled` returns a 400; use `thinking: {"type": "between_tools"}` or low effort.
  - Haiku 5.5 rejects non-default `temperature`/`top_p`/`top_k` and assistant prefill, both with a 400. Use structured outputs instead.
- **Structured outputs:** supported on `claude-haiku-5-5` and `claude-sonnet-5-5` via `output_config.format` with `type: "json_schema"` (<https://platform.claude.com/docs/en/build-with-claude/structured-outputs>). The JSON schema itself is cached for up to 24 h.
- **Free tier:** "New users receive free credits to test the API" (pricing FAQ). There is no ongoing free tier.
- **Rate limits, Start tier** (<https://platform.claude.com/docs/en/api/rate-limits>): Haiku 5.5 and Sonnet 5.5 each get 4,000 RPM, 2,000,000 ITPM and 400,000 OTPM. Cached reads don't count toward ITPM.
  - New organizations may start in a lower "Evaluation" tier until they have usage history.
  - "Ramp limits" can return a 429 on sudden traffic spikes.
- **Spend cap:** yes, a hard cap.
  - Each tier has a monthly cap (Start $500, Build $1,000, Scale $200,000).
  - You can set your own lower limit at Console → Settings → Spend limits (`platform.claude.com/settings/spend-limits`). Requests then fail with HTTP 400 `invalid_request_error` ("You have reached your specified API usage limits") until the month resets.
  - Per-workspace spend limits are also available.
- **Data/training:** "Retained data is never used for model training without your express permission." Conversation content is not retained by default, except for "Covered Models" (Fable/Mythos), which need 30-day retention; Haiku and Sonnet are not Covered Models. Flagged content may be kept up to 2 years. ZDR is available through sales. Batch API data is kept 29 days. Source: <https://platform.claude.com/docs/en/manage-claude/api-and-data-retention>. Anthropic's privacy centre also describes the commercial standard as deletion within 30 days.
- **Latency** (UNVERIFIED; third-party measurements):
  - Throughput: Artificial Analysis (via DeepLearning.AI's The Batch) measures about **236–237 output tokens/s**, the fastest it has tested. 120 output tokens should therefore stream in about 0.5 s.
  - TTFT with thinking **on** is very high: Artificial Analysis reports about 11 s to first answer token at medium effort.
  - Requesty gateway median TTFT for the week of 9–15 Nov 2026: about 1.8 s (mixed workloads).
  - For comparison, Artificial Analysis measured Haiku 4.5 non-reasoning at 0.98 s TTFT; an independent test found about 0.56 s.
  - **Expect about 0.6–1.5 s end-to-end with thinking off. Measure this yourself.**
  - Sources: <https://artificialanalysis.ai/models/claude-haiku-5-5/providers>, <https://www.deeplearning.ai/the-batch/claude-fills-out-its-model-family/>, <https://www.requesty.ai/data/weekly/2026-w46/speed-up>.

### OpenAI: GPT-5 nano / GPT-5.4 nano / GPT-5 mini (UNVERIFIED pricing; official pages blocked)

- **Prices:** see the table. The cheapest current small model appears to be GPT-5 nano ($0.05 / $0.40, figure attributed to the official model page in search). The newer GPT-5.4 nano is listed by trackers at $0.20 / $1.25.
  - Cached input is 10% of the input price.
  - Batch and Flex are about 50% off. Flex is slower and can be preempted.
- **Reasoning tokens:** GPT-5-family models are reasoning models. Set the lowest reasoning effort (`minimal`/`none`, depending on model); otherwise hidden reasoning tokens are billed as output. Not verified for the current models.
- **Structured outputs:** JSON-schema Structured Outputs (`response_format` / `text.format` with `strict`) is supported on the GPT-5 family. Widely documented, but not re-verified this session.
- **Free tier:** no standing API free tier (not verified this session).
- **Rate limits:** usage tiers based on cumulative spend. Entry-tier numbers were not verified.
- **Spend cap:** yes. Per OpenAI's "Spend limits" guide (OFFICIAL snippet, <https://developers.openai.com/api/docs/guides/spend-limits>), project and organization **hard limits** can be set ("Enforce a hard limit"). Requests over the limit get a 429 with `project_spend_limit_exceeded` / `organization_spend_limit_exceeded`. Alerts alone do not stop spend.
- **Data/training** (OFFICIAL snippet, <https://developers.openai.com/api/docs/guides/your-data>): API data is "not used to train or improve OpenAI models (unless you explicitly opt in)". Abuse-monitoring logs are kept up to 30 days. Some endpoints store application state until deleted. ZDR requires approval.
- **Latency:** Artificial Analysis comparison pages exist (e.g. <https://artificialanalysis.ai/models/comparisons/claude-4-5-haiku-vs-gpt-5-nano>), but the extracted figures were inconsistent. GPT-5 nano throughput is about 137 tok/s (benchlm.ai, unverified). No reliable TTFT figure was found.

### Google Gemini: Flash-Lite / Flash (UNVERIFIED pricing; official page blocked)

- **Prices:** search snippets of ai.google.dev and Vertex AI pages disagree.
  - Gemini 3.5 Flash-Lite: about $0.30 / $2.50 (other snapshots: $0.25 / $1.25–1.50).
  - Gemini 3.8 Flash: $0.375 / $1.875 on the Developer API; Vertex shows an introductory $0.75 / $3.75 until 31 Dec 2026.
  - Batch is 50% off. Several rates change on 1 Jan 2027.
- **Thinking:** Flash-tier models have a thinking budget. Set it to minimal/0 where allowed; thinking tokens are billed as output.
- **Structured outputs:** `responseMimeType: application/json` plus `responseSchema`/`responseJsonSchema` (well documented; not re-verified).
- **Free tier:** yes. The Developer API has a free tier for Flash/Flash-Lite with low RPM/RPD limits (OFFICIAL snippet shows a "Free of charge" column). Third-party sources say free-tier content **is used to improve Google's products** and paid-tier content is not; the official wording was not confirmed. **Don't send player data on the free tier** if that matters to you.
- **Spend cap:** yes, since 16 Mar 2026 (OFFICIAL snippets: <https://ai.google.dev/gemini-api/docs/billing>, Google blog <https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/>).
  - Per-project "Monthly spend cap" in AI Studio → Spend. Billing data can lag about 10 minutes, so you **can overshoot**.
  - Billing-account tier caps: Tier 1 $250/month, Tier 2 $2,000.
- **Latency** (UNVERIFIED; Artificial Analysis): Gemini 2.5 Flash-Lite non-reasoning had about 0.39 s TTFT against Haiku 4.5's 0.98 s (<https://artificialanalysis.ai/models/comparisons/claude-4-5-haiku-vs-gemini-2-5-flash-lite>). Reasoning-mode figures for 3.5 Flash-Lite are about 11 s and not comparable.

### DeepSeek: V4-Flash (UNVERIFIED)

- **Prices:** $0.14 cache-miss input, $0.0028 cache-hit input, $0.28 output (official page snippet and deepseek.com platform page). InfoWorld reports a later increase with peak/off-peak pricing (Flash $0.22–0.44 input / $0.66–1.32 output; <https://www.infoworld.com/article/4209439/deepseek-raises-some-v4-prices-by-more-than-10x-as-ai-demand-strains-capacity.html>). **The current price is uncertain.**
  - Context caching is automatic.
  - `deepseek-chat` reportedly deprecated 24 Jul 2026 and mapped to V4-Flash.
- **JSON:** JSON mode (`response_format: json_object`), not strict schema. Not re-verified.
- **Spend control:** prepaid balance, which acts as a natural hard cap. Not verified this session.
- **Data:** data is processed and stored in the PRC under DeepSeek's privacy policy (widely reported, not verified). Consider whether that suits your players.
- **Latency/reliability:** capacity constraints have been reported (the InfoWorld piece). No reliable TTFT figure was found.

### Groq: hosted open models (UNVERIFIED)

- **Prices:**
  - gpt-oss-20b: $0.075 / $0.30 (trackers) or $0.10 / $0.50 (Groq page snippet).
  - Llama 3.1 8B Instant: $0.05 / $0.08.
  - Source: <https://groq.com/pricing> (not fetched).
- **Speed:** Groq's selling point is very high tokens/s (for example about 560 tok/s for Llama 3.1 8B in one October 2026 overview), so short outputs complete very quickly. Not verified.
- **Free tier:** Groq has a rate-limited free developer tier (not verified).
- **Caveat:** an 8B model is noticeably weaker at nuanced eligibility judgements ("does 'the Beeb' count as BBC?"). Expect more wrong verdicts.

---

## 5. Recommendation for a one-person game with a hard monthly budget

**Use Claude Haiku 5.5 (`claude-haiku-5-5`) with thinking disabled, structured outputs, and a Console spend limit.**

Why:

1. **Cost is negligible at realistic scale.** It costs $0.12 per 1,000 validations. At 1,000 daily players and a pessimistic F = 8% the bill is about **$4.32/month**. Even at 100,000 daily players and F = 8% it is about $432, still under the Start tier's $500 cap. The cheaper options (GPT-5 nano, Groq Llama 8B) save cents to a few dollars a month at hobby scale. That is not worth giving up quality or verified pricing.
2. **Hard cap that actually stops spend.** Set an organization (or workspace) spend limit of, say, $10–20 at `platform.claude.com/settings/spend-limits`. Requests then fail with a clear 400 that your code can catch, and the game can fall back to "exact match only" mode. OpenAI also offers hard project limits. Google's cap can overshoot because of billing lag. DeepSeek's prepaid balance works, but its pricing is in flux.
3. **Verified pricing and terms.** These are the only figures in this report read from an official page this session. API data is not used for training, and content is not retained by default for this model.
4. **Quality and features fit the task.** It has strict JSON-schema structured outputs, high throughput (about 237 tok/s measured) and generous Start-tier limits (4,000 RPM).

Implementation notes:
- Send `thinking: {"type": "disabled"}` and keep effort at its default `medium` (or `low`); `disabled` is rejected only at `xhigh`/`max`. This keeps cost at the computed figure and avoids multi-second TTFT. Set `max_tokens` to about 300 as a safety cap.
- Use `output_config.format` (json_schema) for the verdict. Do not set `temperature` (400 on this model).
- Put the stable rules first and the player's answer last, and add `cache_control`. It caches if the prefix is at least the minimum length (confirm 512 tokens in the docs).
- Add a per-player and per-IP limit on AI calls (for example 5 a day) and a global daily call ceiling in your own code. This is a second guard under the provider cap.
- Store every verdict keyed by (question id, normalized answer). This is what drives F down over time.
- Use the Batch API (50% off) only for offline pre-generation of alias lists, never for live guesses.
- Use Sonnet 5.5 (20x the price) only as an optional escalation for disputed verdicts, if at all.

If you want a free option for development, the Gemini free tier works for testing. Don't use it for production player data, because free-tier content may be used to improve Google's products (unverified). Before choosing any non-Anthropic option, re-check its official pricing page; they could not be reached from this session.
