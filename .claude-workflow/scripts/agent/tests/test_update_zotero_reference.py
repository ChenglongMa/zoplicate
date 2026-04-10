from __future__ import annotations

import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.agent.update_zotero_reference import RefreshConfig, is_refresh_due, refresh_reference, should_handle_user_prompt


class OrderedGitRunner:
    def __init__(self, steps: list[tuple[Path, tuple[str, ...], str]]) -> None:
        self.steps = steps
        self.calls: list[tuple[Path, tuple[str, ...]]] = []

    def __call__(self, cwd: Path, args: list[str]) -> str:
        if not self.steps:
            raise AssertionError(f"Unexpected git command: {cwd} {args}")
        expected_cwd, expected_args, output = self.steps.pop(0)
        actual = (cwd, tuple(args))
        self.calls.append(actual)
        if expected_cwd != cwd or expected_args != tuple(args):
            raise AssertionError(f"Expected git command {(expected_cwd, expected_args)}, got {actual}")
        return output


class UpdateZoteroReferenceTests(unittest.TestCase):
    def test_should_handle_user_prompt_matches_milestone_loop(self) -> None:
        self.assertTrue(
            should_handle_user_prompt('{"prompt":"  /milestone-loop milestone=M001"}', "/milestone-loop")
        )
        self.assertFalse(should_handle_user_prompt('{"prompt":"summarize this file"}', "/milestone-loop"))

    def test_is_refresh_due_skips_recent_status_when_repo_exists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            reference_dir = Path(tmp_dir) / ".references" / "zotero"
            (reference_dir / ".git").mkdir(parents=True)
            now = datetime(2026, 4, 10, 13, 0, tzinfo=UTC)
            status = {"checked_at": (now - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")}

            self.assertFalse(is_refresh_due(status, reference_dir, 60, False, now))
            self.assertTrue(is_refresh_due(status, reference_dir, 5, False, now))

    def test_refresh_reference_clones_missing_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            status_path = project_dir / ".claude-workflow" / "state" / "runtime" / "zotero_reference_status.json"
            reference_dir = project_dir / ".references" / "zotero"
            config = RefreshConfig(
                project_dir=project_dir,
                reference_dir=reference_dir,
                status_path=status_path,
                remote_url="https://github.com/zotero/zotero.git",
                branch="main",
                max_age_minutes=60,
                force=False,
            )
            git_runner = OrderedGitRunner(
                [
                    (
                        project_dir,
                        (
                            "clone",
                            "--depth",
                            "1",
                            "--branch",
                            "main",
                            "https://github.com/zotero/zotero.git",
                            str(reference_dir),
                        ),
                        "",
                    ),
                    (reference_dir, ("rev-parse", "HEAD"), "abc123def456\n"),
                ]
            )

            with patch("scripts.agent.update_zotero_reference.shutil.which", return_value="/usr/bin/git"):
                payload = refresh_reference(
                    config,
                    git_runner=git_runner,
                    now=datetime(2026, 4, 10, 13, 0, tzinfo=UTC),
                )

            self.assertEqual(payload["status"], "cloned")
            self.assertEqual(payload["head"], "abc123def456")
            self.assertEqual(git_runner.calls[0][1][0], "clone")

    def test_refresh_reference_updates_when_remote_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            reference_dir = project_dir / ".references" / "zotero"
            (reference_dir / ".git").mkdir(parents=True)
            status_path = project_dir / ".claude-workflow" / "state" / "runtime" / "zotero_reference_status.json"
            config = RefreshConfig(
                project_dir=project_dir,
                reference_dir=reference_dir,
                status_path=status_path,
                remote_url="https://github.com/zotero/zotero.git",
                branch="main",
                max_age_minutes=0,
                force=False,
            )
            git_runner = OrderedGitRunner(
                [
                    (reference_dir, ("rev-parse", "HEAD"), "old123456789\n"),
                    (reference_dir, ("fetch", "--depth", "1", "origin", "main"), ""),
                    (reference_dir, ("rev-parse", "FETCH_HEAD"), "new456789abc\n"),
                    (reference_dir, ("merge", "--ff-only", "FETCH_HEAD"), ""),
                    (reference_dir, ("rev-parse", "HEAD"), "new456789abc\n"),
                ]
            )

            with patch("scripts.agent.update_zotero_reference.shutil.which", return_value="/usr/bin/git"):
                payload = refresh_reference(
                    config,
                    git_runner=git_runner,
                    now=datetime(2026, 4, 10, 13, 0, tzinfo=UTC),
                )

            self.assertEqual(payload["status"], "updated")
            self.assertEqual(payload["previous_head"], "old123456789")
            self.assertEqual(payload["head"], "new456789abc")

    def test_refresh_reference_skips_network_when_recent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            reference_dir = project_dir / ".references" / "zotero"
            (reference_dir / ".git").mkdir(parents=True)
            status_path = project_dir / ".claude-workflow" / "state" / "runtime" / "zotero_reference_status.json"
            config = RefreshConfig(
                project_dir=project_dir,
                reference_dir=reference_dir,
                status_path=status_path,
                remote_url="https://github.com/zotero/zotero.git",
                branch="main",
                max_age_minutes=60,
                force=False,
            )
            status_path.parent.mkdir(parents=True, exist_ok=True)
            status_path.write_text(
                '{\n  "checked_at": "2026-04-10T12:30:00Z",\n  "head": "abc123def456",\n  "last_updated_at": "2026-04-10T12:30:00Z"\n}\n',
                encoding="utf-8",
            )
            git_runner = OrderedGitRunner([])

            with patch("scripts.agent.update_zotero_reference.shutil.which", return_value="/usr/bin/git"):
                payload = refresh_reference(
                    config,
                    git_runner=git_runner,
                    now=datetime(2026, 4, 10, 13, 0, tzinfo=UTC),
                )

            self.assertEqual(payload["status"], "skipped")
            self.assertEqual(payload["head"], "abc123def456")
            self.assertEqual(git_runner.calls, [])


if __name__ == "__main__":
    unittest.main()
