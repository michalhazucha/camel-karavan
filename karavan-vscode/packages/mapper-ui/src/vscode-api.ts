declare const acquireVsCodeApi: () => {
    postMessage: (message: unknown) => void;
};

export interface VsCodeApi {
    postMessage: (message: unknown) => void;
}

let cachedVsCodeApi: VsCodeApi | undefined;

/** VS Code allows acquireVsCodeApi() only once per webview — cache it module-wide. */
export const getVsCodeApi = (): VsCodeApi => {
    if (cachedVsCodeApi) {
        return cachedVsCodeApi;
    }
    if (typeof acquireVsCodeApi === "function") {
        cachedVsCodeApi = acquireVsCodeApi();
        return cachedVsCodeApi;
    }
    cachedVsCodeApi = {
        postMessage: (message: unknown) => {
            console.log("VSCode message:", message);
        },
    };
    return cachedVsCodeApi;
};
