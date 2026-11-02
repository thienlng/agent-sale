# Assistant platform skills

Platform skills for the owner assistant live here, one folder per skill:
`<name>/SKILL.md`, where `<name>` equals the `name` in the front matter.

Each `SKILL.md` starts with `---` front matter (`name`, `description`,
`toolsets`, `version`) followed by the Markdown body. Skills are versioned and
reviewed like prompts; `loadSkillDir(ASSISTANT_SKILLS_DIR)` parses and lints
every skill at load time (see `src/agent/skills.ts`). Files at this top level,
such as this README, are ignored by the loader.
