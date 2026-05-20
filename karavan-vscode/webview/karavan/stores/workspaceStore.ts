import { integrationDirFromRelativePath } from "@/karavan/utils/workspaceFileResolver";
import { shallow } from "zustand/shallow";
import { createWithEqualityFn } from "zustand/traditional";

export const useWorkspaceStore = createWithEqualityFn((set) => ({
    files: [],
    fileContents: {},
    /** Directory of the open integration YAML, relative to workspace root */
    integrationDir: "",
    /** Absolute path to the open integration YAML file */
    integrationFullPath: "",
    isLoaded: false,
    setWorkspaceFiles: (files: string[]) => {
        set({ files, isLoaded: true });
    },
    setIntegrationContext: (relativePath: string, fullPath: string) => {
        set({
            integrationDir: integrationDirFromRelativePath(relativePath),
            integrationFullPath: fullPath.replace(/\\/g, "/"),
        });
    },
    setWorkspaceFileContent: (relativePath: string, content: string) => {
        if (!content || content === '[object Object]' || content === 'Buffer') {
            return;
        }
        set((state) => {
            const fileContents = { ...state.fileContents, [relativePath]: content };
            const base = relativePath.split(/[/\\]/).pop();
            if (base && base !== relativePath) {
                fileContents[base] = content;
            }
            return { fileContents };
        });
    },
    reset: () => {
        set({ files: [], fileContents: {}, integrationDir: "", integrationFullPath: "", isLoaded: false });
    },
}), shallow);
