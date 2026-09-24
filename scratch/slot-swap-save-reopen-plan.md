# Slot swap save/reopen investigation

## Goal

Make a component assigned to a `SLOT` inside a `Layout` instance survive saving and reopening with the same component identity and visual properties. The master component and other `Layout` instances must stay unchanged.

## Reproduction

- Current branch: `codex/fix-slot-swap-reopen`.
- Document: `../storage-root/files/ds-main.fig` (`ДС Скала`).
- Page: `test`.
- Relevant nodes:
  - `1:90` — `Layout` master component.
  - `1:96` — `Main container` slot node in the master.
  - `1:98` — first `Layout` instance, slot remains empty.
  - `1:99` — second `Layout copy` instance, slot assignment points to the red component.
  - `1:101` — `Empty red card` component.
  - `1:8000000796` — cloned `Main container` inside `1:99` after import.
- The editor is already running from this checkout at `http://localhost:1422/files/library/ds-main`; the visible Codex in-app browser tab is left open on `test`.

## What already works

The current uncommitted implementation writes and reads the slot assignment:

```json
{
  "componentPropAssignments": [
    {
      "defID": "0:100",
      "varValue": {
        "value": {
          "slotContentIdValue": { "guid": "1:101" }
        },
        "dataType": "SLOT_CONTENT_ID",
        "resolvedDataType": "SLOT_CONTENT_ID"
      }
    }
  ]
}
```

After import, `1:99.componentPropertyAssignments` is `{ "0:100": "1:101" }`, and `applySlotProp()` creates an instance of `1:101` inside the cloned slot. Therefore the assignment codec and the basic `SLOT_CONTENT_ID` import path are not the remaining failure.

## Confirmed failure

The saved `Layout copy` contains two fill overrides:

1. Correct: `guidPath: [1:96]` with the gray fill of `Main container`.
2. Incorrect/stale: `guidPath: [1:101]` with the same gray fill, but targeting `Empty red card`.

The `1:101` master is red:

```text
rgb(229, 72, 77) / normalized (0.8980, 0.2824, 0.3020)
```

The stale saved override is gray:

```text
rgb(244, 246, 249) / normalized (0.9569, 0.9647, 0.9765)
```

Instrumented import proves the sequence:

1. `applySlotProp()` calls `graph.createInstance("1:101", slotCopyId)`.
2. The new child initially has the correct red fill copied from the component.
3. The final `applySymbolOverrides(ctx, true)` replay resolves the stale `[1:101]` override to that child.
4. `applyOverridePatch()` overwrites its red fill with gray.

The canvas then looks as if the slot content disappeared, although the child instance and assignment still exist in the graph.

## Root cause

`applyInstancePayload()` in `packages/fig/src/node-change/export-node.ts` preserves every raw `node.source.fig.symbolOverrides` entry and then merges live text/fill overrides.

`swapSlotContent()` in `packages/core/src/tools/modify/swap.ts` replaces the slot child and updates `componentPropertyAssignments`, but it does not invalidate raw symbol overrides belonging to the previous/effective slot content. Consequently a stale raw override targeting the assigned component survives the save and is faithfully replayed on the next import.

The import resolver is not inventing the bad color; it applies an explicit bad entry already present in the file. Fixing only the final import replay would hide corrupt export state and could break legitimate overrides.

## Remaining uncertainty to close before implementation

The real `ds-main.fig` already contains the bad `[1:101]` entry, so this document proves the reopen failure but does not yet prove whether the current exporter creates that entry on a clean first save or merely preserves corruption created by an earlier iteration. The regression suite must cover both cases:

- start from a clean graph and assert the first export never emits a content-root override for the assigned slot component;
- start from an imported graph containing a stale content-root override, perform a slot swap, and assert the next export removes only that stale entry.

This distinction prevents a fix that passes the existing document only because it cleans up a historical artifact while leaving a clean-save bug untested.

## Important implementation detail

`graph.updateNode(topInstance.id, { componentPropertyAssignments: ... })` already adds `componentPropertyAssignments` to `topInstance.source.editedFields`. This is a useful signal that the slot assignment changed in the current editing session.

Do not discard all raw `symbolOverrides`: `[1:96]` is a legitimate override of the slot container, and a real document may have many unrelated descendant overrides. Sanitization must be scoped to the old/new slot content path.

## Proposed fix

### Preferred direction

At export time, when an instance has an edited `componentPropertyAssignments` field:

1. Identify `SLOT` property definitions owned by the instance component.
2. Resolve the current assigned component IDs to their exported GUIDs.
3. Filter raw `node.source.fig.symbolOverrides` only for paths rooted at slot-content components whose assignments changed.
4. Preserve every unrelated raw override, including the slot container override (`1:96`).
5. Merge live overrides from `instance.instanceOverrides` afterward, so any edits made to the newly inserted component in the same session are serialized again with current values.

The exporter currently has no check for this mutation marker: `applyInstancePayload()` always materializes raw `node.source.fig.symbolOverrides`. The implementation must explicitly add the slot-aware filtering/invalidating step; calling `releaseOriginalFigArchive()` alone is not sufficient.

If export code cannot reliably determine the previous slot assignment, capture the affected old/new component IDs during `swapSlotContent()`/`clearSlotContent()` in a format-neutral transient marker owned by Scene Graph, then consume that marker during FIG export. Avoid leaking FIG GUID parsing into generic tool logic.

### Additional import hardening (optional, not the primary fix)

Review the single-child fallback in `resolveOverrideTarget()`. It may descend from a slot container into newly inserted content when an old override path can no longer be resolved. A slot boundary should not implicitly retarget an unrelated override. Add a guard only if a focused regression test proves it is needed after export is corrected.

## Regression tests

Add focused tests before changing behavior:

1. **Clean slot round trip**
   - Build a minimal graph with a `Layout` component, a `FRAME` slot using a `SLOT` property reference, a red content component, and two layout instances.
   - Assign the red component only to the second instance.
   - Export, import, export, and import again.
   - Assert the second slot contains an instance whose `componentId` resolves to the red component and whose fill remains red.
   - Assert the first slot remains empty and the master is unchanged.

2. **Stale raw override cleanup after swap**
   - Start from an imported instance with a raw override targeting the old/current slot content and a distinct slot-container override.
   - Execute the slot swap.
   - Export and inspect `symbolData.symbolOverrides`.
   - Assert the stale content override is absent, the slot-container override is preserved, and any new live override is serialized with its current value.

3. **Reopen behavior**
   - Import the exported bytes and assert the restored child fill matches its component master instead of the slot background.

Suggested homes:

- Round-trip behavior: `tests/engine/io/fig/export/component-properties.test.ts` or a new `tests/engine/io/fig/instance/slot-roundtrip.test.ts`.
- Low-level raw override behavior: `packages/fig/tests/export.test.ts`.
- Tool mutation behavior, if needed: a focused test near the existing core tool tests.

## Verification against the real document

1. Keep a recoverable copy of `../storage-root/files/ds-main.fig` before mutation.
2. Open `ДС Скала` → `test` in the current checkout.
3. Swap `Empty red card` into the second `Layout` slot.
4. Save.
5. Close and reopen the document.
6. Confirm visually that only the second `Layout` shows the red card.
7. Parse the saved file and confirm:
   - `1:99` contains slot assignment `0:100 -> 1:101`.
   - No stale gray override targets `1:101`.
   - The restored child instance fill equals the `1:101` master fill.

## Required checks

- Run the focused regression tests.
- Run the linter on every changed/new code file, as required by project rules.
- Run relevant type checks for `@open-pencil/fig` and `@open-pencil/core` if the fix crosses the package boundary.
- Perform the browser save/close/reopen flow without Orca.

## Current cautions

- The worktree contained substantial uncommitted slot work before this investigation; preserve it and avoid broad formatting/reverts.
- `/private/tmp/ds-main-test.fig` and `/private/tmp/ds-main-test2.fig` are earlier experiments, not trustworthy golden fixtures: their `1:101` components have different names/fills.
- Do not create a pull request until the user confirms after implementation and verification.
