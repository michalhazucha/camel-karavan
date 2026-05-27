import { useWorkspaceStore } from "@stores/workspaceStore";
import vscode from "@/vscode";

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
