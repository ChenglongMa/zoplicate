"""Lightweight episodic memory store for Claude workflow tooling."""

from __future__ import annotations

import json
import re
from typing import Any

from scripts.agent.workflow_state import AgentStatePaths, ensure_layout, utc_now

_TOKEN_RE = re.compile(r"[A-Za-z0-9_]{2,}")


def append_jsonl(paths: AgentStatePaths, record: dict[str, Any]) -> None:
    ensure_layout(paths)
    with paths.episodes_jsonl_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _iter_records(paths: AgentStatePaths) -> list[dict[str, Any]]:
    if not paths.episodes_jsonl_path.exists():
        return []

    records: list[dict[str, Any]] = []
    for line in paths.episodes_jsonl_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            records.append(payload)
    return records


def _tokenize(value: str) -> set[str]:
    return {token.lower() for token in _TOKEN_RE.findall(value)}


def _record_text(record: dict[str, Any]) -> str:
    parts = [
        str(record.get("summary", "")),
        str(record.get("resolution", "")),
        str(record.get("phase", "")),
        str(record.get("milestone_id", "")),
    ]
    details = record.get("details", {})
    if isinstance(details, dict):
        parts.extend(f"{key}={value}" for key, value in details.items())
    tags = record.get("tags", [])
    if isinstance(tags, list):
        parts.extend(str(tag) for tag in tags)
    return "\n".join(part for part in parts if part)


def record_episode(
    paths: AgentStatePaths,
    *,
    episode_type: str,
    milestone_id: str,
    phase: str,
    summary: str,
    details: dict[str, Any] | None = None,
    resolution: str = "",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    payload = {
        "timestamp": utc_now(),
        "milestone_id": milestone_id,
        "episode_type": episode_type,
        "phase": phase,
        "summary": summary,
        "details": details or {},
        "resolution": resolution,
        "tags": tags or [],
    }
    append_jsonl(paths, payload)
    return {"status": "ok", "record": payload}


def query_by_pattern(paths: AgentStatePaths, pattern: str, top_k: int = 5) -> list[dict[str, Any]]:
    if not pattern.strip():
        return []

    needle = pattern.lower()
    hits: list[dict[str, Any]] = []
    for record in reversed(_iter_records(paths)):
        haystack = json.dumps(record, ensure_ascii=False).lower()
        if needle not in haystack:
            continue
        hits.append(record)
        if len(hits) >= top_k:
            break
    return hits


def query_by_context(paths: AgentStatePaths, context_text: str, top_k: int = 5) -> list[dict[str, Any]]:
    query_tokens = _tokenize(context_text)
    if not query_tokens:
        return query_by_pattern(paths, context_text, top_k=top_k)

    scored: list[tuple[float, dict[str, Any]]] = []
    for record in _iter_records(paths):
        tokens = _tokenize(_record_text(record))
        if not tokens:
            continue
        overlap = query_tokens & tokens
        if not overlap:
            continue
        score = len(overlap) / max(len(query_tokens), 1)
        scored.append((score, record))

    scored.sort(key=lambda item: (item[0], item[1].get("timestamp", "")), reverse=True)
    return [record for _, record in scored[:top_k]]
