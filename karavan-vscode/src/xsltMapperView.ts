/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { openXsltEditorWithLiveSync } from "./xsltEditorLiveSync";

const page = "xslt-mapper";
const KARAVAN_PANELS: Map<string, vscode.WebviewPanel> = new Map<string, vscode.WebviewPanel>();
const MAPPER_SELECTION_VIEW_ID = "karavan.mapperSelectionPanel";
const DEBUG_SELECTION_PANEL = false;

interface MapperSelectionState {
    selectedSourcePath?: string;
    selectedTargetPath?: string;
    connections?: unknown[];
}

function isLocalAssetRef(ref: string): boolean {
    return !ref.startsWith("http://")
        && !ref.startsWith("https://")
        && !ref.startsWith("data:")
        && !ref.startsWith("vscode-webview:");
}

function resolveAssetPath(buildPath: string, ref: string): string {
    const cleaned = ref.replace(/^\.\//, "");
    return path.join(buildPath, cleaned);
}

function getAssetRefs(html: string, extension: ".js" | ".css"): string[] {
    const pattern = extension === ".js"
        ? /<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g
        : /<link[^>]+href="([^"]+\.css)"[^>]*>/g;
    const refs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
        refs.push(match[1]);
    }
    return refs;
}

async function persistXsltMapperBuildPath(buildPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    try {
        await config.update(
            "Karavan.xsltMapperBuildPath",
            buildPath,
            vscode.ConfigurationTarget.Workspace
        );
    } catch {
        // Machine-scoped settings cannot be saved into workspace settings.
        await config.update(
            "Karavan.xsltMapperBuildPath",
            buildPath,
            vscode.ConfigurationTarget.Global
        );
    }
}

export async function resolveXsltMapperBuildPath(promptUser: boolean = true): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration().get<string>("Karavan.xsltMapperBuildPath")?.trim();
    if (configured && isValidMapperBuildPath(configured)) {
        return configured;
    }

    const workspaceCandidates = (vscode.workspace.workspaceFolders ?? []).map(folder =>
        path.join(folder.uri.fsPath, "xsltmapper-generator", "webview-ui", "build")
    );
    const workspaceOutCandidates = (vscode.workspace.workspaceFolders ?? []).map(folder =>
        path.join(folder.uri.fsPath, "xsltmapper-generator", "out", "webview")
    );
    const homeCandidates = [
        path.join(os.homedir(), "xsltmapper-generator", "webview-ui", "build"),
        path.join(os.homedir(), "xsltmapper-generator", "out", "webview"),
        path.join(os.homedir(), "www", "CGI", "camel-karavan", "xsltmapper-generator", "webview-ui", "build"),
        path.join(os.homedir(), "www", "CGI", "camel-karavan", "xsltmapper-generator", "out", "webview"),
    ];
    const rootCandidates = [
        "/home/michalhazucha/xsltmapper-generator/webview-ui/build",
        "/home/michalhazucha/xsltmapper-generator/out/webview",
    ];
    const allCandidates = [...workspaceCandidates, ...workspaceOutCandidates, ...homeCandidates, ...rootCandidates];

    const candidate = allCandidates.find((candidatePath) => isValidMapperBuildPath(candidatePath));
    if (candidate) {
        await persistXsltMapperBuildPath(candidate);
        return candidate;
    }

    if (!promptUser) {
        return undefined;
    }

    const pick = await vscode.window.showOpenDialog({
        title: "Select xsltmapper-generator webview-ui/build folder",
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
    });
    if (!pick || pick.length === 0) {
        vscode.window.showWarningMessage("Karavan XSLT Mapper: folder not selected.");
        return undefined;
    }

    const selected = pick[0].fsPath;
    if (!isValidMapperBuildPath(selected)) {
        vscode.window.showErrorMessage("Selected folder is not a valid XSLT mapper build output.");
        return undefined;
    }

    await persistXsltMapperBuildPath(selected);
    return selected;
}

export function isValidMapperBuildPath(buildPath: string): boolean {
    const indexPath = path.join(buildPath, "index.html");
    if (!fs.existsSync(indexPath)) {
        return false;
    }

    const html = fs.readFileSync(indexPath, "utf8");
    const jsRefs = getAssetRefs(html, ".js").filter(isLocalAssetRef);
    const cssRefs = getAssetRefs(html, ".css").filter(isLocalAssetRef);

    const hasReferencedJs = jsRefs.some((ref) => fs.existsSync(resolveAssetPath(buildPath, ref)));
    const hasReferencedCss = cssRefs.some((ref) => fs.existsSync(resolveAssetPath(buildPath, ref)));

    if (hasReferencedJs && hasReferencedCss) {
        return true;
    }

    // Backward-compatible fallback for legacy mapper build layout.
    return fs.existsSync(path.join(buildPath, "assets", "index.js"))
        && fs.existsSync(path.join(buildPath, "assets", "index.css"));
}

export function getEmbeddedMapperHtml(buildPath: string): string {
    const rawHtml = fs.readFileSync(path.join(buildPath, "index.html"), "utf8");
    let html = rawHtml;

    const bridgeScript = `
<script>
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (message) {
      window.parent.postMessage({ type: 'xsltMapperBridge', message: message }, '*');
    }
  };
};
</script>`;

    html = html.replace(/<link rel="icon"[^>]*>/g, "");

    const cssRefs = getAssetRefs(html, ".css").filter(isLocalAssetRef);
    cssRefs.forEach((ref) => {
        const assetPath = resolveAssetPath(buildPath, ref);
        if (fs.existsSync(assetPath)) {
            const styleContent = fs.readFileSync(assetPath, "utf8");
            const styleDataUri = `data:text/css;base64,${Buffer.from(styleContent, "utf8").toString("base64")}`;
            html = html.replace(`href="${ref}"`, `href="${styleDataUri}"`);
        }
    });

    const scriptRefs = getAssetRefs(html, ".js").filter(isLocalAssetRef);
    scriptRefs.forEach((ref) => {
        const assetPath = resolveAssetPath(buildPath, ref);
        if (fs.existsSync(assetPath)) {
            const scriptContent = fs.readFileSync(assetPath, "utf8");
            const scriptDataUri = `data:text/javascript;base64,${Buffer.from(scriptContent, "utf8").toString("base64")}`;
            html = html.replace(`src="${ref}"`, `src="${scriptDataUri}"`);
        }
    });

    if (/<head>/i.test(html)) {
        html = html.replace(/<head>/i, `<head>${bridgeScript}`);
    } else {
        html = `${bridgeScript}${html}`;
    }

    return html;
}

export class XsltMapperView {
    private currentPanel: vscode.WebviewPanel | undefined;
    private selectionView: vscode.WebviewView | undefined;
    private karavanPrimaryWebview: vscode.Webview | undefined;
    private mapperSelectionState: MapperSelectionState = {};
    private selectionPanelMessagesBound = false;

    constructor(private context: vscode.ExtensionContext) {
    }

    registerSelectionPanelProvider(): void {
        const provider: vscode.WebviewViewProvider = {
            resolveWebviewView: async (webviewView: vscode.WebviewView) => {
                this.selectionView = webviewView;
                this.configureSelectionPanelWebview(webviewView);
                webviewView.onDidDispose(() => {
                    if (this.selectionView === webviewView) {
                        this.selectionView = undefined;
                        this.selectionPanelMessagesBound = false;
                    }
                });
            },
        };
        this.context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(MAPPER_SELECTION_VIEW_ID, provider),
        );
    }

    refreshSelectionPanel(): void {
        if (!this.selectionView) {
            return;
        }
        this.configureSelectionPanelWebview(this.selectionView);
    }

    private getExtensionMapperDir(): string {
        return path.join(this.context.extensionUri.fsPath, "dist", "mapper");
    }

    private isExtensionSelectionPanelAvailable(): boolean {
        const mapperDir = this.getExtensionMapperDir();
        return fs.existsSync(path.join(mapperDir, "karavan-mapper-selection.js"))
            && (
                fs.existsSync(path.join(mapperDir, "karavan-mapper-selection.css"))
                || fs.existsSync(path.join(mapperDir, "karavan-mapper.css"))
            );
    }

    private getSelectionPanelPlaceholderHtml(message: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
  </style>
</head>
<body>${message}</body>
</html>`;
    }

    private getSelectionPanelWebviewContent(webview: vscode.Webview): string {
        const mapperDir = this.getExtensionMapperDir();
        const jsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(mapperDir, "karavan-mapper-selection.js")),
        ).toString();
        const cssFile = fs.existsSync(path.join(mapperDir, "karavan-mapper-selection.css"))
            ? "karavan-mapper-selection.css"
            : "karavan-mapper.css";
        const cssUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(mapperDir, cssFile)),
        ).toString();
        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; font-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${cssUri}" />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; overflow: auto; }
    body { background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
    #root { min-height: 100%; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="root" class="karavan-mapper-root dark"></div>
  <script src="${jsUri}"></script>
</body>
</html>`;
    }

    private getSelectionPanelDebugContent(webview: vscode.Webview): string {
        const cspSource = webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .meta { margin-bottom: 12px; opacity: 0.9; }
    .list { border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; }
    .row { padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); font-family: var(--vscode-editor-font-family); }
    .row:last-child { border-bottom: 0; }
    .muted { opacity: 0.75; }
  </style>
</head>
<body>
  <div class="meta"><strong>Mapper Selection Debug</strong> <span class="muted">(live data received by bottom panel)</span></div>
  <div id="selection" class="meta">Source: none | Target: none</div>
  <div id="count" class="meta">Mappings: 0</div>
  <div id="list" class="list"><div class="row muted">Waiting for mapperSelectionStateSync...</div></div>
  <script>
    const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
    const listEl = document.getElementById('list');
    const countEl = document.getElementById('count');
    const selectionEl = document.getElementById('selection');
    if (vscode) {
      vscode.postMessage({ command: 'selectionPanelReady' });
    }
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || data.type !== 'mapperSelectionStateSync') return;
      const payload = data.payload || {};
      const connections = Array.isArray(payload.connections) ? payload.connections : [];
      selectionEl.textContent = 'Source: ' + (payload.selectedSourcePath || 'none') + ' | Target: ' + (payload.selectedTargetPath || 'none');
      countEl.textContent = 'Mappings: ' + connections.length;
      if (connections.length === 0) {
        listEl.innerHTML = '<div class="row muted">No mappings in payload.</div>';
        return;
      }
      listEl.innerHTML = connections.map((c) => {
        const src = c && c.sourcePath ? c.sourcePath : '?';
        const tgt = c && c.targetPath ? c.targetPath : '?';
        return '<div class="row">' + src + ' → ' + tgt + '</div>';
      }).join('');
    });
  </script>
</body>
</html>`;
    }

    private configureSelectionPanelWebview(webviewView: vscode.WebviewView): void {
        const mapperDir = this.getExtensionMapperDir();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(mapperDir)],
        };
        if (this.isExtensionSelectionPanelAvailable()) {
            webviewView.webview.html = DEBUG_SELECTION_PANEL
                ? this.getSelectionPanelDebugContent(webviewView.webview)
                : this.getSelectionPanelWebviewContent(webviewView.webview);
            if (!this.selectionPanelMessagesBound) {
                this.bindMapperWebviewMessages(webviewView.webview, "secondary");
                this.selectionPanelMessagesBound = true;
            }
            this.pushSelectionStateToSecondary();
            return;
        }

        webviewView.webview.html = this.getSelectionPanelPlaceholderHtml(
            "Mapper Selection panel assets are missing. Run <code>npm run build:mapper</code> in karavan-vscode, then reload the window.",
        );
    }

    async openKaravanWebView(): Promise<void> {
        const buildPath = await resolveXsltMapperBuildPath();
        if (!buildPath) {
            return;
        }

        if (!KARAVAN_PANELS.has(page)) {
            const panel = vscode.window.createWebviewPanel(
                "karavan-xslt-mapper",
                "Karavan XSLT Mapper",
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.file(buildPath),
                    ],
                }
            );

            panel.webview.html = this.getMapperWebviewContent(panel.webview, buildPath, {
                mode: "full",
                role: "primary",
            });
            panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "icons/karavan.svg");

            this.bindMapperPanelLifecycle(panel);
            this.bindMapperWebviewMessages(panel.webview, "primary");

            panel.onDidDispose(() => {
                if (this.currentPanel === panel) {
                    this.currentPanel = undefined;
                }
                KARAVAN_PANELS.delete(page);
            }, null, this.context.subscriptions);

            KARAVAN_PANELS.set(page, panel);
            this.currentPanel = panel;
            this.pushSelectionStateToSecondary();
        } else {
            const existing = KARAVAN_PANELS.get(page);
            this.currentPanel = existing;
            existing?.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    setKaravanPrimaryWebview(webview: vscode.Webview | undefined): void {
        this.karavanPrimaryWebview = webview;
    }

    updateMapperSelectionState(payload: MapperSelectionState): void {
        this.mapperSelectionState = {
            selectedSourcePath: payload.selectedSourcePath,
            selectedTargetPath: payload.selectedTargetPath,
            connections: Array.isArray(payload.connections) ? payload.connections : [],
        };
        this.pushSelectionStateToSecondary();
    }

    forwardMapperSelectionAction(
        action?: string,
        connectionId?: string,
        transformation?: unknown,
    ): void {
        if (!action) {
            return;
        }
        if (action === "editMapping" && connectionId && this.karavanPrimaryWebview) {
            void this.karavanPrimaryWebview.postMessage({
                command: "focusMapperTab",
                connectionId,
            });
            return;
        }
        if (
            (action === "highlightMapping" || action === "clearHighlightMapping") &&
            this.karavanPrimaryWebview
        ) {
            this.karavanPrimaryWebview.postMessage({
                type: "mapperSelectionAction",
                action,
                connectionId,
            });
            return;
        }
        const message = {
            type: "mapperSelectionAction",
            action,
            connectionId,
            transformation,
        };
        if (this.karavanPrimaryWebview) {
            this.karavanPrimaryWebview.postMessage(message);
            return;
        }
        this.currentPanel?.webview.postMessage(message);
    }

    private getMapperWebviewContent(
        webview: vscode.Webview,
        buildPath: string,
        options?: { mode?: "full" | "selection-panel"; role?: "primary" | "secondary" },
    ): string {
        const rawHtml = fs.readFileSync(path.join(buildPath, "index.html"), "utf8");
        const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "assets", "index.js"))).toString();
        const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "assets", "index.css"))).toString();
        const iconUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "vite.svg"))).toString();
        const mapperRuntimeOptionsScript = `<script>window.__KARAVAN_MAPPER_MODE=${JSON.stringify(options?.mode ?? "full")};window.__KARAVAN_MAPPER_ROLE=${JSON.stringify(options?.role ?? "primary")};</script>`;

        const html = rawHtml
            .replace(/\.\/assets\/index\.js/g, jsUri)
            .replace(/\.\/assets\/index\.css/g, cssUri)
            .replace(/\.\/vite\.svg/g, iconUri);
        if (/<head>/i.test(html)) {
            return html.replace(/<head>/i, `<head>${mapperRuntimeOptionsScript}`);
        }
        return `${mapperRuntimeOptionsScript}${html}`;
    }

    private bindMapperPanelLifecycle(panel: vscode.WebviewPanel): void {
        let openedEditor: { absolutePath: string; isTemp: boolean; watcher: vscode.Disposable } | undefined;

        panel.onDidDispose(() => {
            openedEditor?.watcher.dispose();
            if (openedEditor?.isTemp && openedEditor.absolutePath && fs.existsSync(openedEditor.absolutePath)) {
                fs.unlinkSync(openedEditor.absolutePath);
            }
            openedEditor = undefined;
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            const isOpenPreview =
                message?.type === "openXSLTPreview"
                || message?.command === "openXSLTPreview";
            if (!isOpenPreview) {
                return;
            }

            const xsltContent: string = typeof message.content === "string" ? message.content : "";
            if (!xsltContent.trim() && !message.filePath?.trim()) {
                vscode.window.showWarningMessage("XSLT mapper did not provide content to preview.");
                return;
            }

            try {
                openedEditor?.watcher.dispose();
                if (openedEditor?.isTemp && openedEditor.absolutePath && fs.existsSync(openedEditor.absolutePath)) {
                    fs.unlinkSync(openedEditor.absolutePath);
                }

                const opened = await openXsltEditorWithLiveSync(panel.webview, {
                    content: xsltContent,
                    filePath: typeof message.filePath === "string" ? message.filePath : undefined,
                    integrationDir: typeof message.integrationDir === "string" ? message.integrationDir : undefined,
                    integrationFullPath: typeof message.integrationFullPath === "string"
                        ? message.integrationFullPath
                        : undefined,
                    draft: message.draft !== false,
                });
                if (!opened) {
                    vscode.window.showWarningMessage("XSLT mapper did not provide content to preview.");
                    return;
                }
                openedEditor = opened;
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to open XSLT preview: ${error?.message ?? error}`);
            }
        });
    }

    private bindMapperWebviewMessages(webview: vscode.Webview, role: "primary" | "secondary"): void {
        webview.onDidReceiveMessage(async (message) => {
            if (message?.type === "mapperSelectionState" && role === "primary") {
                this.updateMapperSelectionState({
                    selectedSourcePath: message.payload?.selectedSourcePath,
                    selectedTargetPath: message.payload?.selectedTargetPath,
                    connections: message.payload?.connections,
                });
                return;
            }
            if (message?.type === "mapperSelectionAction" && role === "secondary") {
                this.forwardMapperSelectionAction(
                    message.action,
                    message.connectionId,
                    message.transformation,
                );
                return;
            }
            if (role === "secondary" && message?.command === "selectionPanelReady") {
                this.pushSelectionStateToSecondary();
                return;
            }
            if (role === "primary" && message?.type === "openXSLTPreview") {
                // handled by bindMapperPanelLifecycle listener
                return;
            }
        });
    }

    private pushSelectionStateToSecondary(): void {
        this.selectionView?.webview.postMessage({
            type: "mapperSelectionStateSync",
            payload: this.mapperSelectionState,
        });
    }
}
