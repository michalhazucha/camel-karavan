import { Spinner } from "@patternfly/react-core";
import React, { useEffect, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import { CamelDefinitionApiExt } from "@karavan-core/api/CamelDefinitionApiExt";
import { useDesignerStore, useIntegrationStore } from "../../DesignerStore";
import { isMapperStep } from "./mapperStepUtils";
import { useWorkspaceStore } from "@/karavan/stores/workspaceStore";
import { workspaceFileLookupKeys } from "@/karavan/utils/workspaceFileResolver";
import { requestWorkspaceFile } from "@/karavan/utils/workspaceApi";
import { createKaravanMapperHost } from "./createKaravanMapperHost";
import { ensureMapperReactGlobals } from "./ensureMapperReactGlobals";
import type { KaravanMapperHost } from "@karavan/mapper-core";

type MapperBundle = {
    mountKaravanMapper: (container: HTMLElement, host: KaravanMapperHost) => void;
    unmountKaravanMapper: () => void;
};

const isMapperBundle = (value: unknown): value is MapperBundle =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as MapperBundle).mountKaravanMapper === "function" &&
    typeof (value as MapperBundle).unmountKaravanMapper === "function";

const unmountMapperBundle = (): void => {
    const bundle = (window as Window & { KaravanMapperBundle?: unknown }).KaravanMapperBundle;
    if (isMapperBundle(bundle)) {
        bundle.unmountKaravanMapper();
    }
};

const getMapperAssetBase = (): string => {
    const scripts = document.getElementsByTagName("script");
    for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (!src) {
            continue;
        }
        const webviewMatch = src.match(/^(.*\/)webview\.js(\?.*)?$/);
        if (webviewMatch) {
            return `${webviewMatch[1]}mapper/`;
        }
        const distMatch = src.match(/^(.*\/dist\/)[^/]+\.js(\?.*)?$/);
        if (distMatch) {
            return `${distMatch[1]}mapper/`;
        }
    }
    return "";
};

const readMapperBundle = (): MapperBundle | undefined => {
    const w = window as Window & { KaravanMapperBundle?: unknown };
    if (isMapperBundle(w.KaravanMapperBundle)) {
        return w.KaravanMapperBundle;
    }
    return undefined;
};

const loadMapperBundle = (): Promise<MapperBundle> => {
    const existing = readMapperBundle();
    if (existing) {
        ensureMapperReactGlobals();
        return Promise.resolve(existing);
    }

    const base = getMapperAssetBase();
    if (!base) {
        return Promise.reject(new Error("Could not resolve mapper bundle path (webview.js not found)."));
    }

    const scriptId = "karavan-mapper-script";
    const pending = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (pending) {
        ensureMapperReactGlobals();
        const loadedBundle = readMapperBundle();
        if (loadedBundle) {
            return Promise.resolve(loadedBundle);
        }
        return new Promise((resolve, reject) => {
            const onLoad = () => {
                const bundle = readMapperBundle();
                if (bundle) {
                    resolve(bundle);
                } else {
                    reject(new Error("Mapper bundle script loaded but exports are missing. Run npm run build:mapper and reload."));
                }
            };
            if (pending.dataset.karavanMapperLoaded === "true") {
                onLoad();
                return;
            }
            pending.addEventListener("load", onLoad, { once: true });
            pending.addEventListener("error", () => reject(new Error(`Failed to load ${pending.src}`)), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        ensureMapperReactGlobals();
        const cssId = "karavan-mapper-css";
        if (!document.getElementById(cssId)) {
            const link = document.createElement("link");
            link.id = cssId;
            link.rel = "stylesheet";
            link.href = `${base}karavan-mapper.css`;
            document.head.appendChild(link);
        }

        const script = document.createElement("script");
        script.id = scriptId;
        script.src = `${base}karavan-mapper.js`;
        script.async = true;
        script.onload = () => {
            script.dataset.karavanMapperLoaded = "true";
            const bundle = readMapperBundle();
            if (bundle) {
                resolve(bundle);
            } else {
                reject(
                    new Error(
                        "Mapper bundle loaded but KaravanMapperBundle is missing mount/unmount exports. Run npm run build:mapper and reload.",
                    ),
                );
            }
        };
        script.onerror = () => reject(new Error(`Failed to load ${script.src}`));
        document.body.appendChild(script);
    });
};

export const KaravanMapperMount = () => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<KaravanMapperHost | null>(null);
    const mapperStepUuidRef = useRef<string | undefined>(undefined);
    const [loadError, setLoadError] = useState<string>();
    const [isLoading, setIsLoading] = useState(true);
    const [selectedStep] = useDesignerStore((s) => [s.selectedStep], shallow);

    const mapperStep = isMapperStep(selectedStep) ? selectedStep : undefined;

    useEffect(() => {
        mapperStepUuidRef.current = mapperStep?.uuid;
    }, [mapperStep?.uuid]);

    useEffect(() => {
        if (!mapperStep) {
            unmountMapperBundle();
            hostRef.current = null;
            setIsLoading(false);
            return;
        }

        const container = containerRef.current;
        if (!container) {
            return;
        }

        let cancelled = false;
        setIsLoading(true);
        setLoadError(undefined);

        const mount = async () => {
            try {
                const bundle = await loadMapperBundle();
                if (cancelled) {
                    return;
                }
                const host = createKaravanMapperHost(
                    () => {
                        const current = useDesignerStore.getState().selectedStep;
                        if (current && isMapperStep(current)) {
                            return current;
                        }
                        const uuid = mapperStepUuidRef.current;
                        if (!uuid) {
                            return undefined;
                        }
                        return CamelDefinitionApiExt.findElementInIntegration(
                            useIntegrationStore.getState().integration,
                            uuid,
                        );
                    },
                    () => undefined,
                );
                hostRef.current = host;
                bundle.mountKaravanMapper(container, host);
                const ctx = host.getContext();
                const { integrationDir } = useWorkspaceStore.getState();
                const requestMapperFile = (
                    path: string | undefined,
                    role: "source" | "target",
                ) => {
                    if (!path) {
                        return;
                    }
                    const candidates = workspaceFileLookupKeys(path, null);
                    requestWorkspaceFile(path, integrationDir || undefined, candidates, role);
                };
                requestMapperFile(ctx?.sourcePath, "source");
                requestMapperFile(ctx?.targetPath, "target");
                setLoadError(undefined);
            } catch (error: unknown) {
                if (!cancelled) {
                    const message = error instanceof Error ? error.message : String(error);
                    setLoadError(message);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void mount();

        return () => {
            cancelled = true;
            unmountMapperBundle();
            hostRef.current = null;
        };
    }, [mapperStep?.uuid]);

    if (!mapperStep) {
        return null;
    }

    if (loadError) {
        return (
            <div className="pf-v6-c-alert pf-m-danger pf-m-inline">
                <span className="pf-v6-c-alert__title">Mapper UI failed to load</span>
                <div className="pf-v6-c-alert__description">{loadError}</div>
                <p className="pf-v6-c-alert__description">
                    Run <code>npm run build:mapper</code> in karavan-vscode, then reload the window.
                </p>
            </div>
        );
    }

    return (
        <div className="karavan-mapper-mount" style={{ minHeight: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            {isLoading && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 16 }}>
                    <Spinner size="md" aria-label="Loading mapper" />
                    <span>Loading mapper UI…</span>
                </div>
            )}
            <div
                ref={containerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    height: "100%",
                    width: "100%",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            />
        </div>
    );
};
