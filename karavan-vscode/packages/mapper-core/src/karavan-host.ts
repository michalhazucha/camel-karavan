export interface KaravanMapperContext {
    xslt: string;
    sourcePath?: string;
    targetPath?: string;
    workspaceXsdFiles: string[];
}

export interface KaravanMapperSavePayload {
    xslt: string;
    sourcePath?: string;
    targetPath?: string;
}

export type KaravanMapperHostEvent =
    | { type: "contextChanged"; context: KaravanMapperContext | null }
    | { type: "xsltUpdated"; content: string }
    | {
          type: "workspaceFile";
          role: "source" | "target" | "xslt";
          relativePath?: string;
          content?: string;
          error?: string;
      }
    | { type: "workspaceFilePickCanceled"; role?: string };

export interface KaravanMapperHost {
    getContext(): KaravanMapperContext | null;
    /** Cached workspace file text (e.g. from a prior read in this VS Code session). */
    getCachedWorkspaceFile?(relativePath: string): string | undefined;
    pickWorkspaceFile(role: "source" | "target" | "xslt", extensions: string[]): void;
    openXsltInEditor(content: string): void;
    saveToActivity(payload: KaravanMapperSavePayload): void;
    subscribe(handler: (event: KaravanMapperHostEvent) => void): () => void;
}
