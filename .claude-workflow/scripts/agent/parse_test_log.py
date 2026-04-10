#!/usr/bin/env python3
"""Deterministic test log parser for Claude workflow runs."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

PYTEST_SUMMARY_RE = re.compile(r"=+\s+(?P<body>.+?)\s+in\s+(?P<duration>[0-9.]+)s\s+=+")
PYTEST_COLLECTED_RE = re.compile(r"collected\s+(?P<count>\d+)\s+items?")
PYTEST_SHORT_SUMMARY_RE = re.compile(r"^(FAILED|ERROR)\s+(?P<test>\S+)(?:\s+-\s+(?P<message>.+))?$")
TRACE_LINE_RE = re.compile(r"(?P<path>[\w./\-]+(?:\.[jt]sx?|\.py)):(?P<line>\d+):")
ERROR_LINE_RE = re.compile(r"^E\s+(?P<error_type>[A-Za-z_][A-Za-z0-9_.]*)(?::\s*(?P<message>.*))?$")
BLOCK_HEADER_RE = re.compile(r"^_{3,}\s*(?P<header>.+?)\s*_{3,}$")
JEST_LINE_RE = re.compile(r"^(?P<status>PASS|FAIL)\s+(?P<test>\S+)")
JEST_COUNT_RE = re.compile(r"(?P<count>\d+)\s+(?P<label>failed|passed|skipped|todo|total)")
JEST_TIME_RE = re.compile(r"^Time:\s+(?P<duration>[0-9.]+)\s*s", re.MULTILINE)


def _parse_pytest_summary_counts(text: str, exit_code: int) -> tuple[int | None, int, int, int, float]:
    total_tests: int | None = None
    passed = failed = errors = 0
    duration_seconds = 0.0

    collected_match = PYTEST_COLLECTED_RE.search(text)
    if collected_match:
        total_tests = int(collected_match.group("count"))

    for line in reversed(text.splitlines()):
        match = PYTEST_SUMMARY_RE.search(line)
        if not match:
            continue
        duration_seconds = float(match.group("duration"))
        for chunk in match.group("body").split(","):
            chunk = chunk.strip()
            parts = chunk.split(" ", 1)
            if len(parts) != 2 or not parts[0].isdigit():
                continue
            count = int(parts[0])
            label = parts[1]
            if label.startswith("passed"):
                passed = count
            elif label.startswith("failed"):
                failed = count
            elif label.startswith("error"):
                errors = count
        break

    if total_tests is None and any((passed, failed, errors)):
        total_tests = passed + failed + errors
    if total_tests is None:
        total_tests = 0 if exit_code in {0, 5} else failed + errors
    return total_tests, passed, failed, errors, duration_seconds


def _extract_pytest_failure_blocks(text: str) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    in_failures = False

    for line in text.splitlines():
        stripped = line.strip("= ").strip()
        if stripped == "FAILURES":
            in_failures = True
            current = []
            continue
        if not in_failures:
            continue
        if "short test summary info" in line:
            if current:
                blocks.append(current)
            break
        if BLOCK_HEADER_RE.match(line):
            if current:
                blocks.append(current)
            current = [line]
            continue
        if current:
            current.append(line)

    if current:
        blocks.append(current)
    return blocks


def _parse_pytest_failure_entries(text: str) -> list[dict[str, Any]]:
    short_summary = []
    in_summary = False
    for line in text.splitlines():
        if "short test summary info" in line:
            in_summary = True
            continue
        if not in_summary:
            continue
        match = PYTEST_SHORT_SUMMARY_RE.match(line.strip())
        if match:
            short_summary.append(
                {
                    "test": match.group("test"),
                    "message": (match.group("message") or "").strip(),
                }
            )

    blocks = _extract_pytest_failure_blocks(text)
    failures: list[dict[str, Any]] = []
    for index, summary_entry in enumerate(short_summary):
        block = blocks[index] if index < len(blocks) else []
        line_number = None
        error_type = "AssertionError"
        message = summary_entry["message"]
        traceback_summary = "\n".join(block[-5:]).strip() if block else ""

        for block_line in block:
            if line_number is None:
                line_match = TRACE_LINE_RE.search(block_line)
                if line_match:
                    line_number = int(line_match.group("line"))
            error_match = ERROR_LINE_RE.match(block_line.rstrip())
            if error_match:
                error_type = error_match.group("error_type")
                if error_match.group("message"):
                    message = error_match.group("message").strip()
                break

        failures.append(
            {
                "test": summary_entry["test"],
                "line": line_number,
                "error_type": error_type,
                "message": (message or "")[:200],
                "traceback_summary": traceback_summary,
            }
        )

    return failures


def _parse_jest_counts(text: str) -> tuple[int, int, int, float]:
    passed = failed = total = 0
    duration_seconds = 0.0

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("Tests:"):
            for count, label in JEST_COUNT_RE.findall(stripped):
                value = int(count)
                if label == "passed":
                    passed = value
                elif label == "failed":
                    failed = value
                elif label == "total":
                    total = value
        elif stripped.startswith("Time:"):
            match = JEST_TIME_RE.search(stripped)
            if match:
                duration_seconds = float(match.group("duration"))

    if total == 0 and any((passed, failed)):
        total = passed + failed
    return total, passed, failed, duration_seconds


def _parse_jest_failures(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    failures: list[dict[str, Any]] = []
    current_file = ""
    current_lines: list[str] = []

    def flush() -> None:
        if not current_file:
            return
        block = "\n".join(current_lines).strip()
        if not block:
            failures.append(
                {
                    "test": current_file,
                    "line": None,
                    "error_type": "JestFailure",
                    "message": "Test suite failed",
                    "traceback_summary": "",
                }
            )
            return

        message = "Test suite failed"
        line_number = None
        header = ""
        for line in current_lines:
            stripped = line.strip()
            if not header and stripped.startswith("●"):
                header = stripped[1:].strip()
                message = header or message
                continue
            trace_match = TRACE_LINE_RE.search(stripped)
            if trace_match and line_number is None:
                line_number = int(trace_match.group("line"))
            if message == header and stripped and not stripped.startswith("at ") and not stripped.startswith("●"):
                if stripped != current_file:
                    message = stripped
                    break

        failures.append(
            {
                "test": current_file,
                "line": line_number,
                "error_type": "JestFailure",
                "message": message[:200],
                "traceback_summary": "\n".join(current_lines[-8:]).strip(),
            }
        )

    for line in lines:
        match = JEST_LINE_RE.match(line.strip())
        if match:
            if current_file:
                flush()
            current_file = match.group("test")
            current_lines = []
            continue
        if current_file:
            if line.strip().startswith("Test Suites:"):
                flush()
                current_file = ""
                current_lines = []
                continue
            current_lines.append(line)

    if current_file:
        flush()
    return failures


def _generic_summary(text: str, exit_code: int) -> dict[str, Any]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    tail = lines[-10:]
    failure = []
    if exit_code != 0:
        failure.append(
            {
                "test": "command",
                "line": None,
                "error_type": "CommandFailed",
                "message": tail[-1] if tail else f"Command exited with code {exit_code}",
                "traceback_summary": "\n".join(tail[-5:]),
            }
        )
    return {
        "framework": "generic",
        "total_tests": 0,
        "passed": 0,
        "failed": 1 if exit_code != 0 else 0,
        "errors": 0,
        "failures": failure,
        "duration_seconds": 0.0,
        "log_tail": tail,
    }


def parse_test_output(text: str, *, exit_code: int) -> dict[str, Any]:
    pytest_signals = any(
        signal in text
        for signal in ("short test summary info", "collected ", "============================= test session starts")
    )
    if pytest_signals:
        total_tests, passed, failed, errors, duration_seconds = _parse_pytest_summary_counts(text, exit_code)
        failures = _parse_pytest_failure_entries(text)
        if exit_code == 0 and failed == 0 and errors == 0 and passed == 0 and total_tests > 0:
            passed = total_tests
        if exit_code != 0 and failed == 0 and errors == 0 and not failures:
            failed = 1
            total_tests = max(total_tests, 1)
        return {
            "framework": "pytest",
            "total_tests": total_tests,
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "failures": failures,
            "duration_seconds": duration_seconds,
            "log_tail": [line for line in text.splitlines()[-10:] if line.strip()],
        }

    jest_signals = "Test Suites:" in text or any(
        line.startswith(("PASS ", "FAIL ")) for line in (item.strip() for item in text.splitlines())
    )
    if jest_signals:
        total_tests, passed, failed, duration_seconds = _parse_jest_counts(text)
        failures = _parse_jest_failures(text)
        if exit_code != 0 and failed == 0 and not failures:
            failed = 1
            total_tests = max(total_tests, 1)
        return {
            "framework": "jest",
            "total_tests": total_tests,
            "passed": passed,
            "failed": failed,
            "errors": 0,
            "failures": failures,
            "duration_seconds": duration_seconds,
            "log_tail": [line for line in text.splitlines()[-10:] if line.strip()],
        }

    return _generic_summary(text, exit_code)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Parse test command output into JSON.")
    parser.add_argument("--log", required=True, help="Path to the test log file.")
    parser.add_argument("--output", required=True, help="Path to the summary JSON file.")
    parser.add_argument("--exit-code", type=int, default=0, help="Test command exit code.")
    args = parser.parse_args(argv)

    log_path = Path(args.log)
    output_path = Path(args.output)
    text = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""

    summary = parse_test_output(text, exit_code=args.exit_code)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
