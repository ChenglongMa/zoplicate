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
    contracts: list[str] | None = None,
    cascade_hints: list[str] | None = None,
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
        "contracts": contracts or [],
        "cascade_hints": cascade_hints or [],
        "needs_manual_mapping": False,
    }


def make_args(project_dir: Path, **overrides: object) -> Namespace:
    base = dict(
        project_dir=str(project_dir),
        remote_url="file:///fake",
        refs=None,
        also_refs=None,
        release_ref="9.0.4",
        release_series="9.",
        beta_ref="9.0",
        dev_ref="main",
        reference_dir=None,
        watch_targets=".workflow/upstream/zotero_watch_targets.json",
        contract=".workflow/upstream/zotero_upstream_contract.json",
        report=".workflow/upstream/zotero_upstream_report.md",
        milestone_dir=".workflow/milestones",
        update=True,
        check_only=False,
        sync_watch_targets_from_pr_diff=None,
    )
    base.update(overrides)
    return Namespace(**base)


class DummyTempDir:
    def cleanup(self) -> None:
        return None


class AnchorExtractionTests(unittest.TestCase):
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

    def test_class_member_fallback_matches_both_shapes(self) -> None:
        arrow_field = """
class ItemTree {
  _handleSelectionChange = (selection, shouldDebounce) => {
    return this.expand(selection);
  };
}
"""
        class_method = """
class ItemTree {
  _handleSelectionChange(selection, shouldDebounce) {
    return this.expand(selection);
  }
}
"""
        arrow_body, arrow_kind = upstream.extract_anchor_with_kind(arrow_field, "class_member", "_handleSelectionChange")
        method_body, method_kind = upstream.extract_anchor_with_kind(class_method, "class_member", "_handleSelectionChange")

        self.assertIn("this.expand", arrow_body)
        self.assertIn("this.expand", method_body)
        self.assertEqual(arrow_kind, "method_assignment")
        self.assertEqual(method_kind, "class_method")

    def test_missing_anchor_raises(self) -> None:
        with self.assertRaises(ValueError):
            upstream.extract_anchor("const x = 1;\n", "class_member", "_handleSelectionChange")


class RefTierTests(unittest.TestCase):
    def test_infer_role_by_ref_shape(self) -> None:
        self.assertEqual(upstream.infer_role("9.0.4"), upstream.REF_ROLE_RELEASE)
        self.assertEqual(upstream.infer_role("9.0"), upstream.REF_ROLE_BETA)
        self.assertEqual(upstream.infer_role("main"), upstream.REF_ROLE_DEV)

    def test_resolve_release_tag_picks_highest_stable(self) -> None:
        ls_remote = "\n".join(
            [
                "aaa\trefs/tags/9.0.0",
                "bbb\trefs/tags/9.0.10",
                "ccc\trefs/tags/9.0.2",
                "ddd\trefs/tags/9.0.5-beta.1",
                "eee\trefs/tags/8.0.9",
            ]
        )

        def fake_git(_cwd, _args):
            return ls_remote

        self.assertEqual(
            upstream.resolve_release_tag("file:///fake", "9.", git_runner=fake_git),
            "9.0.10",
        )

    def test_build_watched_refs_default_tiers(self) -> None:
        args = make_args(Path("/tmp"))
        watched = upstream.build_watched_refs(args, "file:///fake")
        self.assertEqual(
            watched,
            [("9.0.4", "release"), ("9.0", "beta"), ("main", "dev")],
        )

    def test_build_watched_refs_explicit_override(self) -> None:
        args = make_args(Path("/tmp"), refs=["9.0.4"], also_refs=["main"])
        watched = upstream.build_watched_refs(args, "file:///fake")
        self.assertEqual(watched, [("9.0.4", "release"), ("main", "dev")])


class ComparisonTests(unittest.TestCase):
    def _contract(self, snapshots: dict[str, object]) -> dict[str, object]:
        return {"snapshots": snapshots}

    def test_declaration_shape_move_is_not_a_change(self) -> None:
        old = self._contract(
            {
                "9.0": {
                    "head": "old",
                    "role": "beta",
                    "anchors": {
                        "t": {
                            "status": "ok",
                            "source_path": "a.js",
                            "anchor_kind": "class_member",
                            "anchor_pattern": "x",
                            "matched_kind": "method_assignment",
                            "sha256": "same",
                            "message": "",
                        }
                    },
                }
            }
        )
        new = self._contract(
            {
                "9.0": {
                    "head": "new",
                    "role": "beta",
                    "anchors": {
                        "t": {
                            "status": "ok",
                            "source_path": "a.js",
                            "anchor_kind": "class_member",
                            "anchor_pattern": "x",
                            "matched_kind": "class_method",  # shape flipped
                            "sha256": "same",  # body identical
                            "message": "",
                        }
                    },
                }
            }
        )
        changes = upstream.compare_contracts(old, new, {"9.0": "beta"})
        self.assertEqual(changes, [])

    def test_body_change_is_flagged_with_severity(self) -> None:
        def snap(sha: str) -> dict[str, object]:
            return {
                "head": "h",
                "role": "release",
                "anchors": {
                    "t": {
                        "status": "ok",
                        "source_path": "a.js",
                        "anchor_kind": "class_member",
                        "anchor_pattern": "x",
                        "matched_kind": "class_method",
                        "sha256": sha,
                        "message": "",
                    }
                },
            }

        old = self._contract({"9.0.4": snap("old")})
        new = self._contract({"9.0.4": snap("new")})
        changes = upstream.compare_contracts(old, new, {"9.0.4": "release"})
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["severity"], upstream.SEVERITY_URGENT)

    def test_new_tier_is_baseline_not_drift(self) -> None:
        def snap(sha: str, role: str) -> dict[str, object]:
            return {
                "head": "h",
                "role": role,
                "anchors": {
                    "t": {
                        "status": "ok",
                        "source_path": "a.js",
                        "anchor_kind": "class_member",
                        "anchor_pattern": "x",
                        "matched_kind": "class_method",
                        "sha256": sha,
                        "message": "",
                    }
                },
            }

        # Old contract only knew "9.0"/"main". Adding the "9.0.4" release tier
        # must not register as drift for the new ref.
        old = self._contract({"9.0": snap("s", "beta"), "main": snap("s", "dev")})
        new = self._contract(
            {"9.0.4": snap("s", "release"), "9.0": snap("s", "beta"), "main": snap("s", "dev")}
        )
        changes = upstream.compare_contracts(old, new, {"9.0.4": "release", "9.0": "beta", "main": "dev"})
        self.assertEqual(changes, [])

    def test_dev_only_change_is_radar(self) -> None:
        def snap(sha: str, role: str) -> dict[str, object]:
            return {
                "head": "h",
                "role": role,
                "anchors": {
                    "t": {
                        "status": "ok",
                        "source_path": "a.js",
                        "anchor_kind": "class_member",
                        "anchor_pattern": "x",
                        "matched_kind": "class_method",
                        "sha256": sha,
                        "message": "",
                    }
                },
            }

        old = self._contract({"9.0.4": snap("s", "release"), "main": snap("d-old", "dev")})
        new = self._contract({"9.0.4": snap("s", "release"), "main": snap("d-new", "dev")})
        changes = upstream.compare_contracts(old, new, {"9.0.4": "release", "main": "dev"})
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["severity"], upstream.SEVERITY_RADAR)
        self.assertEqual(upstream.max_severity(changes), upstream.SEVERITY_RADAR)


class SyncTests(unittest.TestCase):
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


class MilestoneTests(unittest.TestCase):
    def test_next_milestone_id_selects_after_existing_m013(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            milestones_dir = Path(tmp_dir) / "milestones"
            milestones_dir.mkdir()
            (milestones_dir / "M002.json").write_text("{}", encoding="utf-8")
            index = {"milestones": [{"id": "M013"}]}

            self.assertEqual(upstream.next_milestone_id(index, milestones_dir), "M014")

    def test_radar_only_milestone_is_planned_and_warns_against_code_change(self) -> None:
        target = make_target(contracts=["single select expands to full duplicate set"])
        changes = [
            {"ref": "main", "role": "dev", "severity": upstream.SEVERITY_RADAR, "target_id": target["id"]}
        ]
        milestone = upstream.build_milestone(
            "M014",
            generated_at="2026-06-09T00:00:00Z",
            latest_accepted="M013",
            changed_targets=[target],
            changes=changes,
            watchlist_changed=False,
            report_rel="r.md",
            contract_rel="c.json",
            targets_rel="t.json",
        )
        self.assertEqual(milestone["status"], "planned")
        self.assertEqual(milestone["upstream_watch"]["severity"], upstream.SEVERITY_RADAR)
        self.assertTrue(any("Do NOT modify release-targeting product code" in line for line in milestone["acceptance"]))
        self.assertTrue(any("contracts still hold" in line for line in milestone["acceptance"]))

    def test_release_affecting_milestone_is_next(self) -> None:
        target = make_target(contracts=["merge prefills master field"])
        changes = [
            {"ref": "9.0.4", "role": "release", "severity": upstream.SEVERITY_URGENT, "target_id": target["id"]}
        ]
        milestone = upstream.build_milestone(
            "M014",
            generated_at="2026-06-09T00:00:00Z",
            latest_accepted="M013",
            changed_targets=[target],
            changes=changes,
            watchlist_changed=False,
            report_rel="r.md",
            contract_rel="c.json",
            targets_rel="t.json",
        )
        self.assertEqual(milestone["status"], "next")
        self.assertEqual(milestone["upstream_watch"]["severity"], upstream.SEVERITY_URGENT)
        self.assertTrue(any("tsc --noEmit" in line or "targeted tests" in line for line in milestone["acceptance"]))


class RunTests(unittest.TestCase):
    def _seed_project(self, project_dir: Path, targets: list[dict[str, object]]) -> tuple[Path, Path]:
        upstream_dir = project_dir / ".workflow" / "upstream"
        milestones_dir = project_dir / ".workflow" / "milestones"
        upstream_dir.mkdir(parents=True)
        milestones_dir.mkdir(parents=True)
        atomic_write_json(upstream_dir / "zotero_watch_targets.json", {"schema_version": "1.0", "targets": targets})

        def anchor(sha: str) -> dict[str, object]:
            return {
                "status": "ok",
                "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                "anchor_kind": "function_assignment",
                "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                "matched_kind": "function_assignment",
                "sha256": sha,
                "message": "",
            }

        atomic_write_json(
            upstream_dir / "zotero_upstream_contract.json",
            {
                "schema_version": "1.1",
                "generated_at_utc": "2026-04-10T00:00:00Z",
                "remote_url": "file:///fake",
                "watched_refs": ["9.0.4", "9.0", "main"],
                "ref_roles": {"9.0.4": "release", "9.0": "beta", "main": "dev"},
                "watch_targets_hash": upstream.stable_json_hash(
                    upstream.normalize_targets_payload({"targets": targets})
                ),
                "watch_targets": targets,
                "snapshots": {
                    "9.0.4": {"head": "r", "role": "release", "anchors": {"duplicates-get-search-object": anchor("old")}},
                    "9.0": {"head": "b", "role": "beta", "anchors": {"duplicates-get-search-object": anchor("old")}},
                    "main": {"head": "d", "role": "dev", "anchors": {"duplicates-get-search-object": anchor("old")}},
                },
            },
        )
        atomic_write_json(
            project_dir / ".workflow" / "milestone_index.json",
            {"milestones": [{"id": "M013", "title": "Accepted", "status": "accepted"}]},
        )
        atomic_write_json(
            project_dir / ".workflow" / "project_snapshot.json",
            {
                "schema_version": "1.0",
                "latest_accepted_milestone": "M013",
                "current_target_milestone": "M013",
                "current_status": "accepted",
                "last_updated_utc": "2026-04-10T00:00:00Z",
                "open_risks_summary": [],
            },
        )
        return upstream_dir, milestones_dir

    def _snapshots(self, release_sha: str, beta_sha: str, dev_sha: str) -> dict[str, object]:
        def anchor(sha: str) -> dict[str, object]:
            return {
                "status": "ok",
                "source_path": "chrome/content/zotero/xpcom/data/duplicates.js",
                "anchor_kind": "function_assignment",
                "anchor_pattern": "Zotero.Duplicates.prototype.getSearchObject",
                "matched_kind": "function_assignment",
                "sha256": sha,
                "message": "",
            }

        return {
            "9.0.4": {"head": "r2", "role": "release", "anchors": {"duplicates-get-search-object": anchor(release_sha)}},
            "9.0": {"head": "b2", "role": "beta", "anchors": {"duplicates-get-search-object": anchor(beta_sha)}},
            "main": {"head": "d2", "role": "dev", "anchors": {"duplicates-get-search-object": anchor(dev_sha)}},
        }

    def test_release_change_generates_next_milestone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            targets = [make_target(contracts=["caches duplicate search object"])]
            upstream_dir, milestones_dir = self._seed_project(project_dir, targets)
            snapshots = self._snapshots("new", "new", "new")  # release moved
            args = make_args(project_dir)

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
            self.assertIn("urgent", report)
            self.assertEqual(contract["snapshots"]["9.0.4"]["anchors"]["duplicates-get-search-object"]["sha256"], "new")
            self.assertEqual(milestone["status"], "next")
            self.assertEqual(milestone["upstream_watch"]["severity"], "urgent")
            self.assertEqual(milestone["upstream_watch"]["changed_targets"], ["duplicates-get-search-object"])
            self.assertEqual(milestone["upstream_watch"]["contract_path"], args.contract)

    def test_dev_only_change_generates_radar_milestone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            project_dir = Path(tmp_dir)
            targets = [make_target(contracts=["caches duplicate search object"])]
            _, milestones_dir = self._seed_project(project_dir, targets)
            snapshots = self._snapshots("old", "old", "dev-new")  # only main moved
            args = make_args(project_dir)

            with (
                patch("scripts.ci.check_zotero_upstream.shutil.which", return_value="/usr/bin/git"),
                patch("scripts.ci.check_zotero_upstream.clone_refs", return_value=(DummyTempDir(), {})),
                patch("scripts.ci.check_zotero_upstream.collect_snapshots", return_value=snapshots),
            ):
                self.assertEqual(upstream.run(args), 0)

            milestone = upstream.load_json(milestones_dir / "M014.json")
            snapshot = upstream.load_json(project_dir / ".workflow" / "project_snapshot.json")
            self.assertEqual(milestone["status"], "planned")
            self.assertEqual(milestone["upstream_watch"]["severity"], "radar")
            self.assertEqual(snapshot["current_status"], "planned")
            self.assertTrue(any("radar" in risk for risk in snapshot["open_risks_summary"]))


if __name__ == "__main__":
    unittest.main()
