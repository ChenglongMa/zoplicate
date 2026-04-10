#!/usr/bin/env bash
set -euo pipefail

uv run python - <<'PY'
import json
import os
import re
import shlex
import sys

payload_raw = os.environ.get("CLAUDE_TOOL_INPUT", "")

try:
    payload = json.loads(payload_raw) if payload_raw else {}
except json.JSONDecodeError:
    sys.exit(0)


def flatten_candidates(value: str) -> list[str]:
    candidates: list[str] = []
    pending = [value]
    seen: set[str] = set()

    while pending:
        current = pending.pop()
        if not isinstance(current, str):
            continue
        current = current.strip()
        if not current or current in seen:
            continue
        seen.add(current)
        candidates.append(current)
        try:
            parts = shlex.split(current)
        except ValueError:
            parts = []
        for part in parts:
            if isinstance(part, str) and part not in seen:
                pending.append(part)
    return candidates


def is_sensitive_reference(candidate: str) -> bool:
    token = candidate.strip("\"'`()[]{};,")
    if not token:
        return False
    if re.search(r"(^|/)\.env(\.[^/\s]+)?$", token):
        return True
    if re.search(r"(^|/)secrets(?:/|$)", token):
        return True
    if re.search(r"\.(pem|key)$", token):
        return True
    return False


fields = []
for key in ("file_path", "path", "command"):
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        fields.extend(flatten_candidates(value))

if any(is_sensitive_reference(candidate) for candidate in fields):
    print("Refusing to access secrets or key material.")
    sys.exit(2)
PY
