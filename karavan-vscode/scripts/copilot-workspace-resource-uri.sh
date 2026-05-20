#!/usr/bin/env bash
#
# XKaravan (karavan-vscode) — briefing for AI assistants (GitHub Copilot, Cursor, etc.)
#
# Run from repo root on any machine after clone:
#   ./scripts/copilot-workspace-resource-uri.sh
#   ./scripts/copilot-workspace-resource-uri.sh --brief > /tmp/xkaravan-brief.txt
#
# Paste the output into Copilot Chat when extending workspace file loading
# for resourceUri / nested paths / Camel placeholders (e.g. file:{{rootDir}}/...).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BRIEF_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --brief) BRIEF_ONLY=true ;;
    -h|--help)
      echo "Usage: $0 [--brief]"
      echo "  Prints architecture + extension tasks for workspace resourceUri resolution."
      exit 0
      ;;
  esac
done

cd "${REPO_ROOT}"

section() {
  echo ""
  echo "================================================================================"
  echo "$1"
  echo "================================================================================"
}

key_files() {
  local f
  for f in \
    "src/utils.ts" \
    "src/designerView.ts" \
    "webview/karavan/utils/workspaceFileResolver.ts" \
    "webview/karavan/utils/workspaceApi.ts" \
    "webview/karavan/utils/workspaceMessageBridge.ts" \
    "webview/karavan/stores/workspaceStore.ts" \
    "webview/App.tsx" \
    "webview/karavan/features/project/designer/property/property/ConfigurationSelectorModal.tsx" \
    "webview/karavan/features/project/designer/property/property/ComponentPropertyField.tsx" \
    "webview/karavan/features/project/designer/property/expression/ExpressionEditor.tsx" \
    "docs/COPILOT-workspace-file-resolution.md"
  do
    if [[ -f "${REPO_ROOT}/${f}" ]]; then
      echo "  ${f} ($(wc -l < "${REPO_ROOT}/${f}" | tr -d ' ') lines)"
    else
      echo "  ${f} (missing)"
    fi
  done
}

section "XKaravan — workspace file resolution (Copilot briefing)"
echo "Repo: ${REPO_ROOT}"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

section "Goal"
cat <<'EOF'
Enable the designer "Set from → Editor" tab to show real file content for resourceUri
(and similar properties) when values are more than a bare filename, e.g.:

  order-transform.xslt                          ← works today (same folder as .camel.yaml)
  transforms/order-transform.xslt               ← nested under integration dir
  file:transforms/order-transform.xslt        ← Camel file: scheme
  file:{{rootDir}}/transforms/order.xslt        ← placeholders (NOT supported yet)
  classpath:com/example/template.xml            ← should not read from workspace FS

User opens a .camel.yaml integration; extension must resolve paths relative to:
  - VS Code workspace root
  - directory of the open integration (integrationDir / integrationFullPath)
  - optional property placeholders (application.properties, DesignerStore)
EOF

if [[ "${BRIEF_ONLY}" == true ]]; then
  section "Key files"
  key_files
  echo ""
  echo "Full spec: docs/COPILOT-workspace-file-resolution.md"
  exit 0
fi

section "Current data flow"
cat <<'EOF'
1. Webview mounts → ensureWorkspaceMessageBridge() + requestWorkspaceFiles()
2. Extension listWorkspaceFiles → workspaceFiles[] (paths relative to workspace root)
3. User opens ConfigurationSelectorModal (gear on resourceUri)
4. resolveBoundFileName(property value) → filename or null (skips if contains "{{")
5. resolveWorkspaceRelativePaths() → candidate relative paths
6. postMessage readWorkspaceFile { relativePath, integrationDir, integrationFullPath, candidatePaths }
7. Extension resolveWorkspaceFileReadCandidates() → tries each path; readWorkspaceRelativeFile()
   MUST return UTF-8 string (Buffer.from(bytes).toString('utf8')) — not raw Uint8Array
8. postMessage workspaceFileContent → workspaceMessageBridge → workspaceStore.fileContents
9. resolveEditorContent() → ExpressionEditor / Monaco

Integration context is set on 'open' in App.tsx:
  setIntegrationContext(relativePath, fullPath)
EOF

section "Key files (edit these)"
key_files

section "Already fixed (do not regress)"
cat <<'EOF'
- workspaceFileContent was not routed to store → workspaceMessageBridge.ts
- Raw Buffer / "[object Object]" in editor → decode in utils + workspaceFileResolver
- Modal polluted global code store → local editorText in ConfigurationSelectorModal
- Monaco value must use ensureEditorString / configurationSelectorSource() scalar string
EOF

section "Known limitations (your work)"
cat <<'EOF'
1. resolveBoundFileName() returns null when value contains "{{" → Editor shows inline text only
2. No parsing of Camel URI prefixes: file:, classpath:, http:, ref:, bean:, resource:
3. resolveWorkspaceFileReadCandidates() uses .pop() basename — may drop directory prefix
   unless full path is already in candidatePaths from webview
4. propertyPlaceholders from DesignerStore are not applied when resolving paths
5. handleDynamicFileContent() in designerView.ts is a separate naive join(workspace, code)
   — not wired into ConfigurationSelectorModal; unify or remove duplication
6. classpath:/http: resources cannot be loaded from workspace; show UX hint in Editor tab
EOF

section "Suggested implementation (ordered)"
cat <<'EOF'
A. Add parseResourceUri(value: string) in webview/karavan/utils/workspaceFileResolver.ts
   - Strip scheme prefix (file, classpath, http, ref, bean, resource)
   - Strip query/fragment
   - Return { scheme, path, hasPlaceholders, raw }

B. Add resolveResourcePath(path, ctx) where ctx =
   { integrationDir, integrationFullPath, workspaceRoot, placeholders: Map<string,string> }
   - Replace {{name}} from propertyPlaceholders + application.properties keys
   - Normalize .. and . segments; reject paths escaping workspace root (mirror extension check)

C. Extend resolveBoundFileName / resolveWorkspaceRelativePaths to use parseResourceUri
   - For file: + relative path: candidates = [
       join(integrationDir, path),
       path,
       workspaceFiles filter endsWith path
     ]
   - For {{...}}: resolve placeholders first; if still unresolved, show read-only hint + raw

D. Extension side (src/utils.ts): resolveWorkspaceFileReadCandidates
   - Accept full relative path (not only basename) as first candidate
   - Optional: new message field resolvedPath from webview to avoid duplicate logic

E. Tests: add node tests for parseResourceUri + resolveResourcePath (jest or vitest if present)

F. Manual test workspace layout:
   project/
     integrations/xslt-integration.camel.yaml
     transforms/order-transform.xslt
   resourceUri: transforms/order-transform.xslt
   resourceUri: file:{{integration.dir}}/transforms/order-transform.xslt
EOF

section "Build & verify"
cat <<'EOF'
  cd karavan-vscode
  pnpm install
  pnpm run compile          # or npm run watch for F5
  F5 → Extension Development Host
  Open *.camel.yaml → resourceUri gear → Editor tab
  Webview console: [XKaravan] loaded workspace file: ... (N chars)

Do not break simple case: resourceUri: order-transform.xslt next to integration YAML.
EOF

section "Example property values to support"
cat <<'EOF'
| Input value                              | Expected editor behavior                    |
|------------------------------------------|---------------------------------------------|
| order-transform.xslt                     | Load sibling file under integration dir     |
| transforms/order-transform.xslt          | Load nested path under integration dir      |
| file:transforms/order-transform.xslt     | Strip file: then same as nested relative    |
| file:{{rootDir}}/transforms/a.xslt       | Resolve placeholder then load (or hint)   |
| classpath:transforms/a.xslt              | Message: not editable from workspace        |
| {{order.transform.path}}                 | Resolve from placeholders map               |
EOF

section "Git diff scope hint (for Copilot)"
echo "Prefer small PR: resolver + tests first, then modal UX for unresolved placeholders."
git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || true
git -C "${REPO_ROOT}" log -1 --oneline 2>/dev/null || true

section "Full documentation"
echo "Read: ${REPO_ROOT}/docs/COPILOT-workspace-file-resolution.md"
echo ""
echo "Copilot prompt starter:"
echo "---"
echo "Extend XKaravan workspace resourceUri resolution per"
echo "docs/COPILOT-workspace-file-resolution.md and scripts/copilot-workspace-resource-uri.sh."
echo "Implement parseResourceUri + placeholder-aware path resolution without breaking"
echo "bare filename loading. Add tests. Keep extension read as UTF-8 strings only."
echo "---"
