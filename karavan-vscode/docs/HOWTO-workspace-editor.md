# HOWTO: Show workspace file content in the Karavan “Set from → Editor” tab

Copy this file (or the **Copilot prompt** at the bottom) into **GitHub Copilot Chat in VS Code** when you want to continue this work on another machine.

**Goal:** When a Camel step has `resourceUri: order-transform.xslt` (or similar), opening the gear icon → **Editor** tab must show the **real file text** from the VS Code workspace—not empty, not `[object Object]`, not `Buffer`.

---

## What works today

| Case | Example | Result |
|------|---------|--------|
| File next to integration YAML | `order-transform.xslt` | Loads sibling file |
| File in integration folder | `integrations/foo.camel.yaml` + `integrations/order-transform.xslt` | Tries `integrations/order-transform.xslt` first |
| Editor language | `.xslt`, `.xml`, `.json`, … | Monaco language from extension |

**Not implemented yet (your next task):**

- `file:transforms/order.xslt` (Camel `file:` prefix)
- Nested paths without listing basename only everywhere
- `file:{{rootDir}}/transforms/order.xslt` (property placeholders)
- Opening **other `.yaml` / `.camel.yaml`** files from a property reference
- `classpath:` / `http:` (should show a message, not read from disk)

---

## How we made it work (end-to-end)

### 1. Extension lists and reads files

**List** all workspace paths (relative to root):

- `designerView.ts` → `listWorkspaceFiles()` → `utils.listWorkspaceRelativeFiles()`
- Posts `{ command: 'workspaceFiles', files: [...] }` to webview

**Read** one file (try several candidate paths):

- Webview sends `{ command: 'readWorkspaceFile', relativePath, integrationDir, integrationFullPath, candidatePaths }`
- `designerView.ts` → `readWorkspaceFile()` builds candidates via `utils.resolveWorkspaceFileReadCandidates()`
- Reads with `utils.readWorkspaceRelativeFile()` — **must** decode bytes to UTF-8:

```ts
const bytes = await readFile(normalizedAbsolute);
return Buffer.from(bytes).toString('utf8');
```

- Posts `{ command: 'workspaceFileContent', relativePath, content }` (string only)

Paths must stay inside the workspace root (`readWorkspaceRelativeFile` checks that).

### 2. Webview receives messages (this was missing at first)

`App.tsx` only handled some commands. **`workspaceFileContent` was ignored.**

Fix: `webview/karavan/utils/workspaceMessageBridge.ts`

- Call `ensureWorkspaceMessageBridge()` from `webview/index.tsx` (and `App.tsx` on mount)
- On `workspaceFileContent`, call `ensureEditorString(msg.content)` and `workspaceStore.setWorkspaceFileContent(path, content)`

### 3. Know which integration is open

When extension opens designer:

```ts
// App.tsx — case 'open'
setIntegrationContext(message.relativePath, message.fullPath);
```

Store keeps `integrationDir` (e.g. `integrations`) and `integrationFullPath` (absolute path to the `.camel.yaml`). File candidates are resolved **relative to that folder first**, then workspace root.

### 4. Modal loads file into Monaco (not global code store)

`ConfigurationSelectorModal.tsx`:

- Property value as **plain string** via `coercePropertyScalar` / `configurationSelectorSource()` in `ComponentPropertyField.tsx`
- Local state `editorText` — do **not** use `useCodeStore` (expression objects became `[object Object]`)
- On open: `resolveBoundFileName()` → if filename, `requestWorkspaceFile(fileName, integrationDir, candidatePaths)`
- On content in store: `resolveEditorContent()` → `setEditorText(...)`

`ExpressionEditor.tsx` always gets `value={ensureEditorString(editorText)}`.

### 5. Path candidates (webview + extension)

`workspaceFileResolver.ts` → `resolveWorkspaceRelativePaths(fileName, workspaceFiles, integrationDir)`:

1. `{integrationDir}/{fileName}`
2. `{fileName}`
3. Any `workspaceFiles` entry ending with that filename

Extension `resolveWorkspaceFileReadCandidates()` tries similar list and reads first path that exists.

### 6. Coercion / Buffer bugs

| Symptom | Cause | Fix |
|---------|--------|-----|
| `[object Object]` | DSL object passed to Monaco / `String(obj)` | `coercePropertyScalar`, local `editorText` |
| `Buffer` | Raw bytes posted to webview | `Buffer.from(bytes).toString('utf8')` in extension; `decodeBinaryContent` in webview |
| Empty editor | No bridge for `workspaceFileContent` | `workspaceMessageBridge.ts` |

`workspaceStore.setWorkspaceFileContent` rejects cached `"Buffer"` and `"[object Object]"`.

---

## Files to touch when extending

| File | Role |
|------|------|
| `src/utils.ts` | `readWorkspaceRelativeFile`, `resolveWorkspaceFileReadCandidates`, `listWorkspaceRelativeFiles` |
| `src/designerView.ts` | `readWorkspaceFile`, `listWorkspaceFiles` message handlers |
| `webview/karavan/utils/workspaceFileResolver.ts` | Parse URI, placeholders, candidate paths, `resolveEditorContent` |
| `webview/karavan/utils/workspaceApi.ts` | `requestWorkspaceFile` postMessage |
| `webview/karavan/utils/workspaceMessageBridge.ts` | Route `workspaceFiles` / `workspaceFileContent` |
| `webview/karavan/stores/workspaceStore.ts` | Cache + integration context |
| `webview/App.tsx` | `setIntegrationContext` on `open` |
| `webview/karavan/features/.../ConfigurationSelectorModal.tsx` | Editor tab, load on open |
| `webview/karavan/features/.../ComponentPropertyField.tsx` | Scalar source for modal, default Editor tab for `resourceUri` |

---

## How to make it more advanced (recommended order)

### Step A — Nested relative paths

Support `resourceUri: transforms/order-transform.xslt` when the integration lives in `integrations/`.

- In `resolveBoundFileName`, allow paths with `/` (already partially works if full path matches `RESOURCE_FILE_PATTERN`).
- In `resolveWorkspaceFileReadCandidates`, try **full relative path first**, not only `path.basename()`.
- Add candidate: `integrationDir + '/' + fullPath`.

### Step B — Strip Camel URI scheme

Support `file:transforms/order.xslt`.

Add `parseResourceUri(raw)` in `workspaceFileResolver.ts`:

- Strip prefixes: `file:`, `classpath:`, `http:`, `https:`, `ref:`, `bean:`, `resource:`
- If scheme is `classpath` / `http` → do not call `readWorkspaceFile`; show UI text in Editor tab.

### Step C — Property placeholders

Support `file:{{some.key}}/transforms/order.xslt`.

- Read placeholders from `DesignerStore` (`propertyPlaceholders`) and/or `application.properties` via extension.
- Replace `{{key}}` before building candidates.
- If placeholders remain unresolved, show read-only raw value + short hint.

### Step D — Other YAML files in Editor

To show content of **another** `.camel.yaml` or `.yaml` referenced by a property:

- Extend `resolveBoundFileName` / file pattern to include `.yaml`, `.yml`, `.camel.yaml`.
- Set Monaco language to `yaml`.
- Same `readWorkspaceFile` pipeline; no special case beyond path resolution.

### Step E — Tests

Add unit tests for `parseResourceUri`, `resolveWorkspaceRelativePaths`, `coercePropertyScalar` (no VS Code required).

---

## Build and manual test (VS Code)

```bash
cd karavan-vscode
pnpm install
pnpm run compile   # or: npm run watch
```

1. **F5** → Extension Development Host  
2. Open workspace folder that contains e.g. `xslt-integration.camel.yaml` and `order-transform.xslt`  
3. Open the integration in Karavan designer  
4. Step **xslt-saxon** → **Resource Uri** → gear → **Editor**  
5. DevTools console (webview): `[XKaravan] loaded workspace file: ... (N chars)`  
6. Editor shows XML/XSLT content  

**Regression:** Simple `order-transform.xslt` beside the YAML must still work after any change.

---

## Copilot prompt (copy from here)

```text
I work on karavan-vscode (XKaravan VS Code extension). Read docs/HOWTO-workspace-editor.md.

We already load workspace files into the designer "Set from → Editor" tab for resourceUri
(simple filenames next to the open .camel.yaml). Implementation:

- Extension: readWorkspaceRelativeFile returns UTF-8 strings; readWorkspaceFile tries candidate paths.
- Webview: workspaceMessageBridge handles workspaceFileContent; workspaceStore caches content;
  ConfigurationSelectorModal uses local editorText and requestWorkspaceFile.

Please extend this WITHOUT breaking the simple case:

1. Nested paths (e.g. transforms/order-transform.xslt relative to integration dir)
2. file: scheme stripping
3. {{placeholder}} resolution from propertyPlaceholders
4. Optional: open other .yaml / .camel.yaml files in the same Editor pipeline
5. classpath:/http: — show message, do not read from workspace FS

Edit workspaceFileResolver.ts and src/utils.ts first; keep changes minimal; add unit tests if possible.
After changes: pnpm run compile, F5 test with order-transform.xslt.
```

---

## More detail

Longer architecture notes: [COPILOT-workspace-file-resolution.md](./COPILOT-workspace-file-resolution.md)

Shell briefing (optional): `scripts/copilot-workspace-resource-uri.sh`
