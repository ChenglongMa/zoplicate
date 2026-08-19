# Zotero 10 upgrade audit

Status: implementation and Zotero 10 smoke testing complete; release acceptance remains tracked by M017.

## Compatibility policy

- Supported Zotero range remains `8.999` through `10.0.*`, preserving Zotero 9 compatibility while adding Zotero 10.
- Dependencies should track current stable releases, with two deliberate runtime/toolchain exceptions:
  - React and React DOM remain on `18.3.1` because the plugin loads Zotero's built-in React 18 runtime.
  - TypeScript remains on `6.0.3` because `typescript-eslint@8.67.0` requires TypeScript `<6.1` and `ts-jest@29.4.12` requires TypeScript `<7`.
- Do not use `--legacy-peer-deps` to force an invalid dependency graph.
- Existing release update files must continue to describe the XPI they were generated for. Update their Zotero bounds only when publishing a newly built and tested XPI.

## Zotero 10 changes handled

- `Zotero.Items.get()` and `getAsync()` can return `false`; item resolution paths now stop safely when an item disappears during an asynchronous operation.
- `Zotero.CollectionTreeCache` was removed in favor of per-row caches; merge code clears it only when the Zotero 9 global exists.
- `ZoteroPane.getCollectionTreeRow()` was removed; duplicate-pane detection prefers `getCollectionTreeRows()`.
- `ZoteroPane.getSelectedLibraryID()` was removed; actions prefer `getSelectedLibraryIDs()`.
- Menu context `collectionTreeRow` was removed; the duplicate-statistics menu prefers `collectionTreeRows`.
- `Cu.unload()` was removed; bootstrap cleanup calls it only on runtimes that still provide it.
- The upstream watcher now follows Zotero `10.0.0`, `10.0`, and `main`, including the collection-view item-tree relocation in Zotero 10.

## Verification completed

- Clean dependency installation and top-level dependency-tree validation.
- TypeScript build and production XPI packaging.
- ESLint validation.
- Full Jest suite.
- Python CI and upstream-watcher unit tests.
- Upstream anchor comparison for Zotero `10.0.0`, `10.0`, and `main`.
- Real Zotero 10 startup, add-on hot reload and shutdown.
- Real duplicate creation, duplicate-set selection, Zoplicate buttons, collection context menu, native merge, and post-merge refresh in the isolated `.scaffold/remote-debug` profile.

## Remaining release checks

1. Run the manual non-duplicate mark/unmark, import/export, and SyncedSettings scenarios in Zotero 10.
2. Repeat the essential startup, menu, duplicate selection, and merge scenarios on Zotero 9 to confirm the fallbacks.
3. Test multiple Zotero windows and a group library with restricted permissions.
4. Install the production XPI into a clean Zotero 10 profile rather than through scaffold temporary-add-on loading.
5. Generate release update metadata only after the production XPI passes the clean-profile checks.
6. Re-run `npm audit`; the current remaining advisory is the unfixed `zotero-plugin-scaffold -> adm-zip` chain. Do not accept npm's forced downgrade to scaffold `0.1.7`.

The Zotero 10 test client logged an upstream `duplicateSelectedItem().done is not a function` error when its own “Create Duplicate Item” context-menu command was used. The duplicate was still created, and the stack did not involve Zoplicate; keep it separate from add-on regressions unless Zotero changes that behavior.

## Repeatable gate

```sh
npm ci
npm test -- --runInBand
npm run build
npx eslint .
uv run python -m unittest discover scripts -p 'test_*.py'
npm ls --depth=0
npm outdated --long
npm audit
```

For the isolated runtime test:

```sh
FORCE_ZOTERO_INSTALL=1 npm run zotero:install
npm run zotero:doctor
npm run zotero:debug
npm run zotero:stop
```
