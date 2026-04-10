#!/usr/bin/env python3
"""Episodic memory MCP server for the Claude workflow runtime."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    from mcp.server.fastmcp import FastMCP
except ModuleNotFoundError as exc:  # pragma: no cover - runtime dependency guard
    FastMCP = None
    _MCP_IMPORT_ERROR = exc
else:
    _MCP_IMPORT_ERROR = None

from scripts.agent.episodic_store import query_by_context
from scripts.agent.episodic_store import record_episode as store_record_episode
from scripts.agent.workflow_state import build_paths

if FastMCP is not None:
    mcp = FastMCP("episodic-memory")
else:  # pragma: no cover - exercised only when dependency is missing
    mcp = None


def _paths():
    return build_paths(os.environ.get("CLAUDE_PROJECT_DIR"))


def _record_episode_impl(
    type: str,
    milestone: str,
    phase: str = "",
    summary: str = "",
    details: str = "{}",
    resolution: str = "",
    tags: str = "[]",
) -> str:
    try:
        payload = store_record_episode(
            _paths(),
            episode_type=type,
            milestone_id=milestone,
            phase=phase,
            summary=summary,
            details=json.loads(details) if details else {},
            resolution=resolution,
            tags=json.loads(tags) if tags else [],
        )
        return json.dumps(payload)
    except Exception as exc:  # pragma: no cover - defensive runtime check
        return json.dumps({"status": "error", "message": str(exc)})


def _query_episodes_impl(context_text: str, top_k: int = 5) -> str:
    try:
        results = query_by_context(_paths(), context_text, top_k=top_k)
        return json.dumps({"status": "ok", "count": len(results), "episodes": results})
    except Exception as exc:  # pragma: no cover - defensive runtime check
        return json.dumps({"status": "error", "message": str(exc)})


if mcp is not None:

    @mcp.tool()
    def record_episode(
        type: str,
        milestone: str,
        phase: str = "",
        summary: str = "",
        details: str = "{}",
        resolution: str = "",
        tags: str = "[]",
    ) -> str:
        """Record a structured episode to episodic memory."""

        return _record_episode_impl(type, milestone, phase, summary, details, resolution, tags)


    @mcp.tool()
    def query_episodes(context_text: str, top_k: int = 5) -> str:
        """Query episodic memory using lightweight lexical similarity."""

        return _query_episodes_impl(context_text, top_k=top_k)

else:

    def record_episode(
        type: str,
        milestone: str,
        phase: str = "",
        summary: str = "",
        details: str = "{}",
        resolution: str = "",
        tags: str = "[]",
    ) -> str:
        return _record_episode_impl(type, milestone, phase, summary, details, resolution, tags)


    def query_episodes(context_text: str, top_k: int = 5) -> str:
        return _query_episodes_impl(context_text, top_k=top_k)


if __name__ == "__main__":
    if mcp is None:  # pragma: no cover - runtime dependency guard
        message = (
            "Missing dependency 'mcp'. Run via "
            "`uv run --with mcp python .claude-workflow/scripts/agent/episodic_mcp_server.py`."
        )
        raise SystemExit(message) from _MCP_IMPORT_ERROR
    mcp.run(transport="stdio")
