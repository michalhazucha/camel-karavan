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

const page = "xslt-mapper";
const KARAVAN_PANELS: Map<string, vscode.WebviewPanel> = new Map<string, vscode.WebviewPanel>();

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
    constructor(private context: vscode.ExtensionContext) {
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

            panel.webview.html = this.getMapperWebviewContent(panel.webview, buildPath);
            panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "icons/karavan.svg");

            this.bindMapperMessages(panel);

            panel.onDidDispose(() => {
                KARAVAN_PANELS.delete(page);
            }, null, this.context.subscriptions);

            KARAVAN_PANELS.set(page, panel);
        } else {
            KARAVAN_PANELS.get(page)?.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    private getMapperWebviewContent(webview: vscode.Webview, buildPath: string): string {
        const rawHtml = fs.readFileSync(path.join(buildPath, "index.html"), "utf8");
        const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "assets", "index.js"))).toString();
        const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "assets", "index.css"))).toString();
        const iconUri = webview.asWebviewUri(vscode.Uri.file(path.join(buildPath, "vite.svg"))).toString();

        return rawHtml
            .replace(/\.\/assets\/index\.js/g, jsUri)
            .replace(/\.\/assets\/index\.css/g, cssUri)
            .replace(/\.\/vite\.svg/g, iconUri);
    }

    private bindMapperMessages(panel: vscode.WebviewPanel): void {
        let tempXsltFilePath: string | undefined;
        let fileWatcher: vscode.Disposable | undefined;

        panel.onDidDispose(() => {
            if (fileWatcher) {
                fileWatcher.dispose();
            }
            if (tempXsltFilePath && fs.existsSync(tempXsltFilePath)) {
                fs.unlinkSync(tempXsltFilePath);
            }
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type !== "openXSLTPreview") {
                return;
            }

            const xsltContent: string = typeof message.content === "string" ? message.content : "";
            if (!xsltContent) {
                vscode.window.showWarningMessage("XSLT mapper did not provide content to preview.");
                return;
            }

            try {
                tempXsltFilePath = path.join(os.tmpdir(), `karavan-xsltmapper-${Date.now()}.xslt`);
                fs.writeFileSync(tempXsltFilePath, xsltContent, "utf8");

                const doc = await vscode.workspace.openTextDocument(tempXsltFilePath);
                await vscode.window.showTextDocument(doc, {
                    preview: false,
                    viewColumn: vscode.ViewColumn.Beside,
                });

                if (fileWatcher) {
                    fileWatcher.dispose();
                }
                fileWatcher = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
                    if (savedDoc.uri.fsPath === tempXsltFilePath) {
                        const updated = fs.readFileSync(tempXsltFilePath!, "utf8");
                        panel.webview.postMessage({
                            type: "xsltUpdated",
                            content: updated,
                        });
                    }
                });
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to open XSLT preview: ${error?.message ?? error}`);
            }
        });
    }
}