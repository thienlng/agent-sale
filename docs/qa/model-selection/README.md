# Model selection

How to compare LLMs for the shop bot and the owner assistant, and the dated results.

## Run a bench

Live runs use the providers configured in `/admin/llm` (DATABASE_SYSTEM_URL). `--model` points every tier
route at one model of the route's primary provider, with no fallback, for that run only; the stored
configuration is never changed.

```bash
# Shop bot: every case twice
pnpm --filter @agent-sales/backend eval --live --model gpt-6.1-terra --repeat 2 --out <dir>
# Owner assistant: every case three times
pnpm --filter @agent-sales/backend eval:assistant --live --model gpt-6.1-terra --repeat 3
```

`--model` also takes an effort: `gpt-6.1-sol@medium`. Without it each route keeps its own effort.

The output gives, per model:

- **Critical** and **Total**: a case passes only when every run passed.
- **Flaky**: cases that passed some runs and failed others.
- **Latency**: P50 and P95 of a whole customer turn (shop bot) or chat turn (assistant), tool rounds included.
- **Model calls and tokens** (input and output), as reported by the provider.

Run one model at a time: finish every suite of one model before starting the next, never in parallel. A
ChatGPT subscription behind Hermes has a 5-hour usage limit; two models in parallel hit it and left both
half done. Calls the limit refuses are listed as "Errored, not graded": rerun just those with
`--id <id>,<id>` after the reset.

## Choosing

1. A model that fails a critical case on any run is not eligible.
2. Among the eligible models, prefer the higher total pass rate, then fewer flaky cases.
3. When they are close, prefer the faster P95, then fewer tokens (cost on the production API).

The bench recommends. Changing a production route stays an admin action in `/admin/llm`.

## Results

| Date | Note |
| --- | --- |
| 2026-11-14 | [GPT-6.1 terra vs sol on Hermes](2026-11-14-gpt-6.1-terra-vs-sol.md) |
