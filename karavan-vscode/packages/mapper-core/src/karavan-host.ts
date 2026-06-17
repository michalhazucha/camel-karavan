export interface KaravanSourceVariable {
    /** Label in mapper tree, usually `$` + bindingName (XSLT param name). */
    variableReceive: string;
    /** BW5 variable name used in XSLT (`xsl:param` / `$messageVar`). */
    bindingName?: string;
    /** Karavan `variableReceive` on the producing step (may differ from bindingName). */
    stepVariableReceive?: string;
    schemaPath?: string;
    kind?: "upstream" | "xslt-param";
}

export interface KaravanMapperContext {
    xslt: string;
    /** Display name of the selected activity (from description or kamelet title). */
    activityName?: string;
    /** Workspace path to XSLT file when mapping is stored in inputBinding (BW5 CallProcess, etc.). */
    xsltPath?: string;
    sourcePath?: string;
    targetPath?: string;
    /** BW5 upstream process variables (from variableReceive on earlier steps). */
    sourceVariables?: KaravanSourceVariable[];
    workspaceXsdFiles: string[];
    /** True only for dedicated Mapper / Transform steps (not CallProcess with inputBinding). */
    allowLoadXsd?: boolean;
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
    notifySelectionState?(payload: {
        selectedSourcePath?: string;
        selectedTargetPath?: string;
        connections?: unknown[];
    }): void;
    pickWorkspaceFile(role: "source" | "target" | "xslt", extensions: string[]): void;
    openXsltInEditor(content: string): void;
    saveToActivity(payload: KaravanMapperSavePayload): void;
    subscribe(handler: (event: KaravanMapperHostEvent) => void): () => void;
}
