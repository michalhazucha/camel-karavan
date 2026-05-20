import vscode from "@/vscode";

export const requestWorkspaceFiles = () => {
    console.log("Sending listWorkspaceFiles command");
    vscode?.postMessage({ command: "listWorkspaceFiles" });
};

export const requestWorkspaceFile = (relativePath: string) => {
    vscode?.postMessage({ command: "readWorkspaceFile", relativePath });
};