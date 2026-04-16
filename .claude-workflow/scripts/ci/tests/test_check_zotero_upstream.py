from __future__ import annotations

import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from scripts.agent.workflow_state import atomic_write_json
from scripts.ci import check_zotero_upstream as upstream


def make_target(
    target_id: str = "duplicates-get-search-object",
    *,
    local_paths: list[str] | None = None,
    upstream_paths: list[str] | None = None,
    anchor_kind: str = "function_assignment",
    anchor_pattern: str = "Zotero.Duplicates.prototype.getSearchObject",
) -> dict[str, object]:
    return {
        "id": target_id,
        "upstream_ref_paths": upstream_paths or ["chrome/content/zotero/xpcom/data/duplicates.js"],
        "anchor_kind": anchor_kind,
        "anchor_pattern": anchor_pattern,
        "local_dependency_paths": local_paths or ["src/modules/patchGetSearchObject.ts"],
        "reason": "test target",
        "risk_level": "high",
        "recommended_tests": ["tests/patchFindDuplicates.cross.test.ts"],
        "needs_manual_mapping": False,
    }


class DummyTempDir:
    def cleanup(self) -> None:
        return None


class CheckZoteroUpstreamTests(unittest.TestCase):
    def test_extracts_supported_anchor_shapes(self) -> None:
        assignment = """
Zotero.Duplicates.prototype.getSearchObject = async function () {
  const nested = { value: true };
  return nested;
};
"""
        exported = """
export async function mergeItems(items) {
  return items.map((item) => ({ key: item.key }));
}
"""
        declaration = """
async function moveRelations(fromItem, toItem) {
  if (fromItem) {
    return toItem;
  }
}
"""
        class_method = """
class DuplicatesMergePane {
  setItems(items) {
    if (items.length) {
      return items;
    }
  }
}
"""

        self.assertIn(
            "return nested",
            upstream.extract_anchor(
                assignment,
                "function_assignment",
                "Zotero.Duplicates.prototype.getSearchObject",
            ),
        )
        self.assertIn("items.map", upstream.extract_anchor(exported, "exported_function", "mergeItems"))
        self.assertIn("return toItem", upstream.extract_anchor(declaration, "function_declaration", "moveRelations"))
        self.assertIn("items.length", upstream.extract_anchor(class_method, "class_method", "setItems"))

    def test_sync_watch_targets_updates_local_file_rename(self) -> None:
        targets = [make_target(local_paths=["src/modules/oldPatch.ts"])]
        diff = """diff --git a/src/modules/oldPatch.ts b/src/modules/newPatch.ts
similarity index 100%
rename from src/modules/oldPatch.ts
rename to src/modules/newPatch.ts
"""

        updated, changed = upstream.sync_watch_targets_from_diff_text(targets, diff)

        self.assertTrue(changed)
        self.assertEqual(updated[0]["local_dependency_paths"], ["src/modules/newPatch.ts"])
        self.assertEqual(updated[0]["anchor_pattern"], "Zotero.Duplicates.prototype.getSearchObject")

    def test_sync_watch_targets_removes_deleted_unused_target(self) -> None:
        targets = [make_target(local_paths=["src/modules/removedPatch.ts"])]
        diff = """diff --git a/src/modules/removedPatch.ts b/src/modules/removedPatch.ts
deleted file mode 100644
--- a/src/modules/removedPatch.ts
+++ /dev/null
@@ -1 +0,0 @@
-Zotero.Duplicates.prototype.getSearchObject = value;
"""

        updated, changed = upstream.sync_watch_targets_from_diff_text(targets, diff)

        self.assertTrue(changed)
        self.assertEqual(updated, [])

    def test_sync_watch_targets_adds_manual_mapping_for_unknown_dependencies(self) -> None:
        targets: list[dict[str, object]] = []
        diff = """diff --git a/src/modules/newZoteroGlue.ts b/src/modules/newZoteroGlue.ts
new file mode 100644
--- /dev/null
+++ b/src/modules/newZoteroGlue.ts
@@ -0,0 +1,4 @@
+const mergeModule = ChromeUtils.importESModule("chrome://zotero/content/mergeItems.mjs");
+const pane = document.querySelector("#duplicates-merge-pane");
+Zotero.Item.prototype._saveData.call(item);
+patchMethod(Zotero.Item.prototype, "_saveData", replacement);
"""

        updated, changed = upstream.sync_watch_targets_from_diff_text(targets, diff)

        self.assertTrue(changed)
        self.assertTrue(all(target["needs_manual_mapping"] for target in updated))
        self.assertTrue(any(target["upstream_ref_paths"] == ["chrome/content/zotero/mergeItems.mjs"] for target in updated))
        self.assertTrue(any(target["anchor_pattern"] == "#duplicates-merge-pane" for target in updated))
        self.assertTrue(any(target["anchor_pattern"] == "Zotero.Item.prototype._saveData" for target in updated))

    def test_next_milestone_id_selects_after_existing_m013(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            milestones_dir = Path(tmp_dir) / "milestones"
            milestones_dir.mkdir()
            (milestones_dir / "M002.json").write_text("{}", encoding="utf-8")
            index = {"milestones": [{"id": "M013"}]}

            self.assertEqual(upstream.next_milestone_id(index, milestones_dir), "M014")

    def test_run_generates_report_contract_and_milestone_after_anchor_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            targets = [make_target()]
            upstream_dir = project_dir / ".claude-workflow" / "docs" / "ai" / "upstream"
            milestones_dir = project_dir / ".claude-workflow" / "docs" / "ai" / "milestones"
            upstream_dir.mkdir(parents=True)
            milestones_dir.mkdir(parents=True)
            atomic_write_json(upstream_dir / "zotero_watch_targets.json", {"schema_version": "1.0", "targets": targets})
            atomic_write_json(
                upstream_dir / "zotero_upstream_contract.json",
                {
                    "schema_version": "1.0",
                    "generated_at_utc": "2026-04-10T00:00:00Z",
                    "remote_url": "file:///fake",
                    "watched_refs": ["9.0", "main"],
                    "watch_targets_hash": upstream.stable_json_hash(upstream.normalize_targets_payload({"targets": targets})),
                    "watch_targets": targets,
                    "snapshots": {
                        "9.0": {
                            "head": "old",
                            "anchors": {
                                "duplicates-get-search-object": {
                                    "status": "ok",
                                    "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                                    "anchor_kind": "function_assignment",
                                    "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                                    "sha256": "old-sha",
                                    "message": "",
                                }
                            },
                        },
                        "main": {
                            "head": "old-main",
                            "anchors": {
                                "duplicates-get-search-object": {
                                    "status": "ok",
                                    "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                                    "anchor_kind": "function_assignment",
                                    "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                                    "sha256": "old-sha",
                                    "message": "",
                                }
                            },
                        },
                    },
                },
            )
            atomic_write_json(
                project_dir / ".claude-workflow" / "docs" / "ai" / "milestone_index.json",
                {"milestones": [{"id": "M013", "title": "Accepted", "status": "accepted"}]},
            )
            atomic_write_json(
                project_dir / ".claude-workflow" / "docs" / "ai" / "project_snapshot.json",
                {
                    "schema_version": "1.0",
                    "latest_accepted_milestone": "M013",
                    "current_target_milestone": "M013",
                    "current_status": "accepted",
                    "last_updated_utc": "2026-04-10T00:00:00Z",
                    "open_risks_summary": [],
                },
            )
            snapshots = {
                "9.0": {
                    "head": "new",
                    "anchors": {
                        "duplicates-get-search-object": {
                            "status": "ok",
                            "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                            "anchor_kind": "function_assignment",
                            "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                            "sha256": "new-sha",
                            "message": "",
                        }
                    },
                },
                "main": {
                    "head": "new-main",
                    "anchors": {
                        "duplicates-get-search-object": {
                            "status": "ok",
                            "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                            "anchor_kind": "function_assignment",
                            "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                            "sha256": "new-sha",
                            "message": "",
                        }
                    },
                },
            }
            args = Namespace(
                project_dir=str(project_dir),
                remote_url="file:///fake",
                refs=None,
                also_refs=None,
                watch_targets=".claude-workflow/docs/ai/upstream/zotero_watch_targets.json",
                contract=".claude-workflow/docs/ai/upstream/zotero_upstream_contract.json",
                report=".claude-workflow/docs/ai/upstream/zotero_upstream_report.md",
                milestone_dir=".claude-workflow/docs/ai/milestones",
                update=True,
                check_only=False,
                sync_watch_targets_from_pr_diff=None,
            )

            with (
                patch("scripts.ci.check_zotero_upstream.shutil.which", return_value="/usr/bin/git"),
                patch("scripts.ci.check_zotero_upstream.clone_refs", return_value=(DummyTempDir(), {})),
                patch("scripts.ci.check_zotero_upstream.collect_snapshots", return_value=snapshots),
            ):
                self.assertEqual(upstream.run(args), 0)

            report = (upstream_dir / "zotero_upstream_report.md").read_text(encoding="utf-8")
            milestone = upstream.load_json(milestones_dir / "M014.json")
            contract = upstream.load_json(upstream_dir / "zotero_upstream_contract.json")
            self.assertIn("duplicates-get-search-object", report)
            self.assertEqual(contract["snapshots"]["9.0"]["anchors"]["duplicates-get-search-object"]["sha256"], "new-sha")
            self.assertEqual(milestone["upstream_watch"]["changed_targets"], ["duplicates-get-search-object"])
            self.assertEqual(milestone["upstream_watch"]["contract_path"], args.contract)


if __name__ == "__main__":
    unittest.main()
