import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { resolveStoredPath } from "./propertiesResolver";
import * as utils from "./utils";

const DEBOUNCE_MS = 250;
/** XSLT files are small; also stay well below VS Code's ~50MB extension sync limit. */
const MAX_XSLT_FILE_BYTES = 10 * 1024 * 1024;

export const postXsltUpdated = (webview: vscode.Webview, content: string): void => {
    webview.postMessage({
        command: "xsltUpdated",
        type: "xsltUpdated",
        content,
    });
};

export const bindXsltEditorLiveSync = (
    webview: vscode.Webview,
    filePath: string,
): vscode.Disposable => {
    const normalizedPath = path.normalize(filePath);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const pushContent = (content: string) => {
        if (content.trim()) {
            postXsltUpdated(webview, content);
        }
    };

    const schedulePush = (doc: vscode.TextDocument) => {
        if (path.normalize(doc.uri.fsPath) !== normalizedPath) {
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => pushContent(doc.getText()), DEBOUNCE_MS);
    };

    const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
        schedulePush(event.document);
    });

    const saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
        if (path.normalize(doc.uri.fsPath) !== normalizedPath) {
            return;
        }
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
        pushContent(doc.getText());
    });

    return vscode.Disposable.from(changeListener, saveListener, new vscode.Disposable(() => {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }
    }));
};

const isUsableXsltFile = (absolutePath: string): boolean => {
    try {
        const stat = fs.statSync(absolutePath);
        return stat.isFile() && stat.size > 0 && stat.size <= MAX_XSLT_FILE_BYTES;
    } catch {
        return false;
    }
};

export const resolveWorkspaceXsltAbsolutePath = async (
    filePath: string,
    integrationDir?: string,
    integrationFullPath?: string,
): Promise<string | undefined> => {
    const trimmed = filePath?.trim();
    if (!trimmed) {
        return undefined;
    }

    const workspaceRoot = utils.getRoot() ?? "";
    const propertiesSearchDir = integrationFullPath
        ? path.dirname(integrationFullPath)
        : workspaceRoot;
    const searchRoot = propertiesSearchDir || workspaceRoot;

    const tryAbsolute = (candidate: string): string | undefined => {
        if (!candidate) {
            return undefined;
        }
        const absolute = path.isAbsolute(candidate)
            ? path.resolve(candidate)
            : workspaceRoot
                ? path.resolve(workspaceRoot, candidate)
                : path.resolve(candidate);
        return isUsableXsltFile(absolute) ? absolute : undefined;
    };

    if (trimmed.includes("{{") && searchRoot) {
        const stored = trimmed.startsWith("file:") ? trimmed : `file:${trimmed}`;
        try {
            const resolved = await resolveStoredPath(stored, workspaceRoot || searchRoot, propertiesSearchDir || searchRoot);
            const fromPlaceholder = tryAbsolute(resolved);
            if (fromPlaceholder) {
                return fromPlaceholder;
            }
        } catch {
            // fall through to candidate resolution
        }
    }

    const candidates = utils.resolveWorkspaceFileReadCandidates(trimmed, integrationDir, integrationFullPath);
    for (const candidate of candidates) {
        const match = tryAbsolute(candidate);
        if (match) {
            return match;
        }
    }

    return tryAbsolute(trimmed.replace(/^file:/i, ""));
};

const openInTextEditor = async (absolutePath: string): Promise<vscode.TextDocument | undefined> => {
    const uri = vscode.Uri.file(absolutePath);
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside,
        });
        return doc;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("50MB") || message.includes("cannot be synchronized")) {
            await vscode.commands.executeCommand("vscode.open", uri);
            return undefined;
        }
        throw error;
    }
};

export interface OpenXsltEditorOptions {
    content?: string;
    /** inputBinding path — used only to seed draft content when content is empty */
    filePath?: string;
    integrationDir?: string;
    integrationFullPath?: string;
    /**
     * When true (default), open a temp draft for live edit → mapper sync.
     * The workspace inputBinding file is not opened or modified until Save to Activity.
     */
    draft?: boolean;
}

export interface OpenXsltEditorResult {
    absolutePath: string;
    isTemp: boolean;
    watcher: vscode.Disposable;
}

const readWorkspaceXsltContent = async (
    filePath: string,
    integrationDir?: string,
    integrationFullPath?: string,
): Promise<string | undefined> => {
    const absolutePath = await resolveWorkspaceXsltAbsolutePath(filePath, integrationDir, integrationFullPath);
    if (!absolutePath || !isUsableXsltFile(absolutePath)) {
        return undefined;
    }
    return fs.readFileSync(absolutePath, "utf8").trim();
};

export const openXsltEditorWithLiveSync = async (
    webview: vscode.Webview,
    options: OpenXsltEditorOptions,
): Promise<OpenXsltEditorResult | undefined> => {
    const useDraft = options.draft !== false;
    const hasBindingPath = Boolean(options.filePath?.trim());
    let content = options.content?.trim() ?? "";

    if (!content && hasBindingPath) {
        content = (await readWorkspaceXsltContent(
            options.filePath!,
            options.integrationDir,
            options.integrationFullPath,
        )) ?? "";
    }

    if (!content) {
        return undefined;
    }

    if (content.length > MAX_XSLT_FILE_BYTES) {
        throw new Error("XSLT content is too large to open in the editor.");
    }

    let absolutePath: string;
    let isTemp: boolean;

    if (!useDraft && hasBindingPath) {
        const workspacePath = await resolveWorkspaceXsltAbsolutePath(
            options.filePath!,
            options.integrationDir,
            options.integrationFullPath,
        );
        if (!workspacePath) {
            throw new Error(
                `XSLT file not found or not readable: ${options.filePath}. Check project.root.* in application.properties.`,
            );
        }
        absolutePath = workspacePath;
        isTemp = false;
    } else {
        const bindingLabel = hasBindingPath
            ? path.basename(options.filePath!.replace(/^file:/i, ""), path.extname(options.filePath!))
            : "draft";
        absolutePath = path.join(
            os.tmpdir(),
            `karavan-xsltmapper-${bindingLabel}-${Date.now()}.xslt`,
        );
        fs.writeFileSync(absolutePath, content, "utf8");
        isTemp = true;
    }

    const doc = await openInTextEditor(absolutePath);
    const watcher = doc
        ? bindXsltEditorLiveSync(webview, absolutePath)
        : new vscode.Disposable(() => undefined);
    return { absolutePath, isTemp, watcher };
};
