# Prompt Audit Log

## 2026-04-10

- Adopted the Claude workflow template into Zoplicate.
- Kept Claude discovery entrypoints at the repository root and moved workflow internals under `.claude-workflow/`.
- Replaced the template's Python-app assumptions with Zoplicate's Node/TypeScript and Jest commands.
- Swapped the heavy semantic episodic-memory implementation for a lighter JSONL-backed store to avoid unnecessary dependencies in this repository.
