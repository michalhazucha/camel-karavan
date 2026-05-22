import { useWorkspaceStore } from "@stores/workspaceStore";
import {
    ensureEditorString,
    normalizeWorkspaceResourcePath,
    workspaceFileLookupKeys,
} from "@/karavan/utils/workspaceFileResolver";

let registered = false;

export const ensureWorkspaceMessageBridge = (): void => {
    if (registered || typeof window === "undefined") {
        return;
    }
    registered = true;
    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg?.command) {
            return;
        }
        const store = useWorkspaceStore.getState();
        switch (msg.command) {
            case "workspaceFiles":
                store.setWorkspaceFiles(msg.files ?? []);
                break;
            case "workspaceFileContent": {
                const content = ensureEditorString(msg.content);
                if (msg.relativePath != null && content.length > 0) {
                    console.log("[XKaravan] loaded workspace file:", msg.relativePath, `(${content.length} chars)`);
                    const keys = workspaceFileLookupKeys(
                        typeof msg.requestedPath === 'string' ? msg.requestedPath : msg.relativePath,
                        msg.relativePath,
                    );
                    keys.forEach((key) => store.setWorkspaceFileContent(key, content));
                } else if (msg.error) {
                    console.warn("[XKaravan] workspace file read failed:", msg.relativePath, msg.error);
                }
                break;
            }
            default:
                break;
        }
    });
};
