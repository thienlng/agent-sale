# @agent-sales/ai-core

The only package allowed to talk to LLM providers (ADR-005, Rule 05).

- `LlmGateway`: tier → provider/model routing, fallback as degraded-cost mode, `admit` hook (admission controller / per-tenant budgets, docs/16 §2b) and `record` hook (metering → `ai_runs`, ledger).
- `FakeLlmProvider`: deterministic provider for unit tests and evals — no network in tests, ever.
- `PromptRegistry`: prompts are files `prompts/<name>@<version>.md`; callers pin a version; placeholders must all be provided.
- Agent pieces (`src/agent`): `runAgentLoop` and the tool runner; for the owner assistant, `scanUntrustedText` (safety scan for memory and skills), the SKILL.md parser/linter/loader (`parseSkill`, `lintSkill`, `renderSkillIndex`, `loadSkillDir`) and the compaction planner (`shouldCompact`, `planCompaction`, `buildCompactionPrompt`).
- `ASSISTANT_SKILLS_DIR`: platform skills shipped as files `assistant-skills/<name>/SKILL.md`, reviewed like prompts.
- To add later (T-007): real provider adapters, retrieval interface, tool runner, guardrails, eval runner in `evals/`.

Changing a prompt or the tier→model map requires running the evals (`docs/13` §2).
