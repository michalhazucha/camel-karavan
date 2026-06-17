import { useWorkspaceStore } from "@stores/workspaceStore";
import vscode from "@/vscode";
import { workspaceFileLookupKeys } from "@/karavan/utils/workspaceFileResolver";

export const requestWorkspaceFiles = () => {
    vscode?.postMessage({ command: "listWorkspaceFiles" });
};

export const requestWorkspaceFile = (
    relativePath: string,
    integrationDir?: string,
    candidatePaths?: string[],
    requestedRole?: "source" | "target" | "xslt",
) => {
    const { integrationFullPath } = useWorkspaceStore.getState();
    vscode?.postMessage({
        command: "readWorkspaceFile",
        relativePath,
        integrationDir: integrationDir || undefined,
        integrationFullPath: integrationFullPath || undefined,
        candidatePaths: candidatePaths?.length ? candidatePaths : undefined,
        requestedRole,
    });
};

export const requestWriteWorkspaceFile = (relativePath: string, content: string) => {
    const { integrationDir, integrationFullPath } = useWorkspaceStore.getState();
    vscode?.postMessage({
        command: "writeWorkspaceFile",
        relativePath,
        content,
        integrationDir: integrationDir || undefined,
        integrationFullPath: integrationFullPath || undefined,
    });
};

/** Drop cached content so the next read fetches from disk. */
export const invalidateWorkspaceFileCache = (relativePath: string) => {
    const keys = workspaceFileLookupKeys(relativePath, null);
    const store = useWorkspaceStore.getState();
    keys.forEach((key) => store.clearWorkspaceFileContent(key));
};
