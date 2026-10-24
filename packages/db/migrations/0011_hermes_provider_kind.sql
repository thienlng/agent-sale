-- ADR-010: allow the isolated Hermes runtime as an LLM provider kind.
alter table llm_providers drop constraint if exists llm_providers_kind_check;
alter table llm_providers
  add constraint llm_providers_kind_check check (kind in ('anthropic', 'openai_compatible', 'hermes'));
