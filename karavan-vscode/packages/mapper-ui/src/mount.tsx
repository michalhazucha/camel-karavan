import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import "./index.css";
import type { KaravanMapperHost } from "./karavan-host";
import { applyMapperDarkClass, isVsCodeDarkBody } from "./lib/vscode-theme";

let root: Root | null = null;

export const mountKaravanMapper = (container: HTMLElement, host?: KaravanMapperHost): void => {
    container.classList.add("karavan-mapper-root");
    applyMapperDarkClass(isVsCodeDarkBody());
    root?.unmount();
    root = createRoot(container);
    root.render(
        <StrictMode>
            <App host={host} />
        </StrictMode>,
    );
};

export const unmountKaravanMapper = (): void => {
    root?.unmount();
    root = null;
};

declare global {
    interface Window {
        KaravanMapperBundle?: {
            mountKaravanMapper: typeof mountKaravanMapper;
            unmountKaravanMapper: typeof unmountKaravanMapper;
        };
    }
}

const karavanMapperApi = {
    mountKaravanMapper,
    unmountKaravanMapper,
};

window.KaravanMapperBundle = karavanMapperApi;

export default karavanMapperApi;
