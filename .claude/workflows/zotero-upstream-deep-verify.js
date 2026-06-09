export const meta = {
  name: 'zotero-upstream-deep-verify',
  description: 'Verify Zotero upstream behavioral contracts per tier and trace relocated logic (Layer B/C)',
  whenToUse:
    'After check_zotero_upstream.py flags drift. Confirms whether each changed anchor still satisfies Zoplicate\'s behavioral contracts on the release/beta/dev tiers, and traces where removed logic relocated (one hop).',
  phases: [
    { title: 'Load', detail: 'read report, contract, watchlist; build per-target work list' },
    { title: 'Verify', detail: 'one agent per changed target: check each contract on each tier' },
    { title: 'Trace', detail: 'for broken/missing contracts, find where the logic moved' },
    { title: 'Synthesize', detail: 'merge verdicts into a tiered impact report' },
  ],
}

// ---------------------------------------------------------------------------
// Layer A (the Python script) already told us WHICH anchors moved. This
// workflow is Layer B (did the behavioral CONTRACT still hold, per tier) and
// Layer C (if logic was removed, where did it go — one hop). It is read-only:
// it writes a single synthesis report and never touches product code.
//
// Tier semantics (must be respected when judging impact):
//   release (X.Y.Z tag)   -> urgent   : users affected now
//   beta    (X.Y branch)  -> scheduled: ships next, pre-adapt
//   dev     (main)        -> radar    : future only, track don't chase
// ---------------------------------------------------------------------------

const CONTRACT_PATH = '.workflow/upstream/zotero_upstream_contract.json'
const WATCHLIST_PATH = '.workflow/upstream/zotero_watch_targets.json'
const REPORT_PATH = '.workflow/upstream/zotero_upstream_report.md'
const OUT_PATH = '.workflow/upstream/zotero_upstream_deep_verify.md'

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['target_id', 'tier_verdicts', 'overall'],
  properties: {
    target_id: { type: 'string' },
    tier_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'role', 'contracts_hold', 'evidence'],
        properties: {
          ref: { type: 'string' },
          role: { type: 'string', enum: ['release', 'beta', 'dev'] },
          contracts_hold: { type: 'boolean' },
          broken_contracts: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
        },
      },
    },
    overall: { type: 'string', enum: ['holds', 'broken-on-dev', 'broken-on-beta', 'broken-on-release'] },
  },
}

const TRACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['target_id', 'relocated', 'summary'],
  properties: {
    target_id: { type: 'string' },
    relocated: { type: 'boolean' },
    new_location: { type: 'string' },
    new_symbol: { type: 'string' },
    affects_local: { type: 'array', items: { type: 'string' } },
    suggested_new_target: {
      type: 'object',
      additionalProperties: true,
      description: 'A watch-target stub for the relocated logic, or empty if none.',
    },
    summary: { type: 'string' },
  },
}

phase('Load')
log('Reading upstream contract, watchlist, and report to build the work list.')

const loaded = await agent(
  `You are preparing a work list for Zotero upstream contract verification.

Read these files and return structured data:
- ${REPORT_PATH} (the latest drift report; identifies changed targets and severity)
- ${CONTRACT_PATH} (snapshots per ref, with ref_roles mapping ref -> release/beta/dev)
- ${WATCHLIST_PATH} (targets with their behavioral "contracts" and "cascade_hints")

Return one entry per CHANGED target (targets appearing in the report's changed table,
or any target with needs_manual_mapping=true). For each include: target_id, anchor_pattern,
upstream_ref_paths, the contracts array, the cascade_hints array, local_dependency_paths,
and the per-ref status/severity from the report.`,
  {
    phase: 'Load',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ref_roles', 'targets'],
      properties: {
        ref_roles: { type: 'object', additionalProperties: { type: 'string' } },
        targets: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['target_id', 'contracts'],
            properties: {
              target_id: { type: 'string' },
              anchor_pattern: { type: 'string' },
              upstream_ref_paths: { type: 'array', items: { type: 'string' } },
              contracts: { type: 'array', items: { type: 'string' } },
              cascade_hints: { type: 'array', items: { type: 'string' } },
              local_dependency_paths: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
)

const work = (loaded?.targets || []).filter(Boolean)
if (work.length === 0) {
  log('No changed targets to verify. Nothing to do.')
  return { verified: [], note: 'no changed targets' }
}
log(`${work.length} changed target(s) to verify across tiers.`)

// Pipeline: each target is verified (Layer B), then — only if a contract broke
// or the anchor went missing — traced (Layer C). No barrier: a target that
// holds skips tracing immediately while others are still verifying.
const results = await pipeline(
  work,
  (target) =>
    agent(
      `Verify Zotero behavioral contracts for watch target "${target.target_id}".

Anchor: ${target.anchor_pattern || '(see watchlist)'}
Upstream file(s): ${(target.upstream_ref_paths || []).join(', ')}
Contracts Zoplicate depends on:
${(target.contracts || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n') || '  (none recorded — infer from local consumers)'}

For EACH watched ref/tier (release tag, beta branch "9.0", dev "main"), inspect the
upstream source for this anchor and decide whether EVERY contract above still holds.
Use the zotero-reference MCP for dev/main, and read the released tag where available.
A contract "holds" if the observable behavior is preserved even if the code was
refactored. Cite concrete evidence (file:line, code shape). Set overall to the
WORST tier where a contract breaks (release worst, then beta, then dev). If nothing
breaks, overall="holds".`,
      { label: `verify:${target.target_id}`, phase: 'Verify', schema: VERDICT_SCHEMA },
    ).then((verdict) => ({ target, verdict })),
  (verified) => {
    if (!verified) return null
    const { target, verdict } = verified
    if (!verdict || verdict.overall === 'holds') {
      return { target_id: target.target_id, verdict, trace: null }
    }
    // Layer C: a contract broke somewhere — find where the logic went.
    return agent(
      `A Zotero behavioral contract for "${target.target_id}" broke on at least one tier.

Broken verdict: ${JSON.stringify(verdict.tier_verdicts)}
Cascade hints (where relocated logic might live):
${(target.cascade_hints || []).map((h) => `  - ${h}`).join('\n') || '  (none)'}
Local Zoplicate consumers that may need updating:
${(target.local_dependency_paths || []).join(', ')}

Trace, ONE HOP only, where the removed/changed upstream logic relocated. Search the
upstream clone (zotero-reference MCP) for the behavior, not just the old symbol name.
If you find it, report new_location (file), new_symbol, and which local files are
affected. Propose a watch-target stub (id, upstream_ref_paths, anchor_kind, anchor_pattern,
contracts) for the new location so the next watch run covers it. If you cannot find it,
set relocated=false and explain. Do NOT propose product code edits.`,
      { label: `trace:${target.target_id}`, phase: 'Trace', schema: TRACE_SCHEMA },
    ).then((trace) => ({ target_id: target.target_id, verdict, trace }))
  },
)

phase('Synthesize')
const clean = results.filter(Boolean)

const synthesis = await agent(
  `Synthesize a Zotero upstream deep-verification report from these per-target results:

${JSON.stringify(clean, null, 2)}

Ref roles: ${JSON.stringify(loaded.ref_roles || {})}

Produce a concise markdown report with:
1. A summary line: how many contracts hold, broke-on-dev, broke-on-beta, broke-on-release.
2. A "Release-affecting (act now)" section: targets broken on release or beta, with the
   broken contract, evidence, relocated logic, and affected local files.
3. A "Dev radar (track only)" section: targets broken only on main, with relocated logic
   and proposed new watch targets — explicitly note product code must NOT change for these.
4. A "Proposed watchlist additions" section listing any suggested_new_target stubs.
5. A "Recommended next step" line: /milestone-tdd if release/beta broke, otherwise
   "update watchlist + re-run check, no product change".
Output ONLY the markdown, starting directly with the "# Zotero Upstream Deep-Verification Report"
heading. Do not prepend any conversational sentence before the heading.`,
  { phase: 'Synthesize' },
)

// The workflow subagents cannot write under .workflow/ (outside their MCP
// scope), so the main thread persists `report` to OUT_PATH after this returns.
return { out_path: OUT_PATH, report: synthesis, results: clean }
