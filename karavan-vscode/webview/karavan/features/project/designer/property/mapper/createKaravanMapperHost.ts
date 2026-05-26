import { CamelDefinitionApiExt } from "@karavan-core/api/CamelDefinitionApiExt";
import { CamelUtil } from "@karavan-core/api/CamelUtil";
import {
    ExpressionDefinition,
    LanguageExpression,
} from "@karavan-core/model/CamelDefinition";
import { CamelElement } from "@karavan-core/model/IntegrationDefinition";
import type {
    KaravanMapperContext,
    KaravanMapperHost,
    KaravanMapperHostEvent,
    KaravanMapperSavePayload,
} from "@karavan/mapper-core";
import { useWorkspaceStore } from "@stores/workspaceStore";
import vscode from "@/vscode";
import { EventBus } from "../../utils/EventBus";
import { useDesignerStore, useIntegrationStore } from "../../DesignerStore";
import { resolvePathAgainstIntegrationDir } from "@/karavan/utils/workspaceFileResolver";
import {
    getMapperXslt,
    parseMapperConfig,
    serializeMapperConfig,
    type MapperConfig,
} from "./mapperStepUtils";

const getWorkspaceXsdFiles = (files: string[]): string[] =>
    files
        .filter((f) => /\.(xsd|xml|wsdl|xsl|xslt)$/i.test(f))
        .sort((a, b) => a.localeCompare(b));

const normalizePath = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");

const pathsMatch = (configured?: string, loaded?: string): boolean => {
    if (!configured || !loaded) {
        return false;
    }
    const a = normalizePath(configured);
    const b = normalizePath(loaded);
    if (a === b) {
        return true;
    }
    const aBase = a.split("/").pop() ?? a;
    const bBase = b.split("/").pop() ?? b;
    return aBase === bBase && aBase.length > 0;
};

const resolveMapperAssetPath = (path: string | undefined, integrationDir: string): string | undefined => {
    if (!path?.trim()) {
        return undefined;
    }
    const normalized = normalizePath(path.trim());
    if (!integrationDir) {
        return normalized;
    }
    const dir = normalizePath(integrationDir);
    if (normalized.includes("..") || normalized.startsWith(".")) {
        return resolvePathAgainstIntegrationDir(normalized, dir);
    }
    if (normalized.includes("/")) {
        return normalized;
    }
    return `${dir}/${normalized}`;
};

export const buildMapperContext = (
    step: CamelElement | undefined,
    workspaceFiles: string[],
    integrationDir = "",
): KaravanMapperContext | null => {
    if (!step) {
        return null;
    }
    const config = parseMapperConfig((step as any)?.note);
    return {
        xslt: getMapperXslt(step),
        sourcePath: resolveMapperAssetPath(config.sourcePath, integrationDir),
        targetPath: resolveMapperAssetPath(config.targetPath, integrationDir),
        workspaceXsdFiles: getWorkspaceXsdFiles(workspaceFiles),
    };
};

export const saveMapperToActivity = (
    mapperStep: CamelElement,
    payload: KaravanMapperSavePayload,
): CamelElement => {
    const clone = CamelUtil.cloneStep(mapperStep) as any;
    const config: MapperConfig = {
        sourcePath: payload.sourcePath?.trim() || undefined,
        targetPath: payload.targetPath?.trim() || undefined,
    };

    if (clone.dslName === "TransformDefinition") {
        clone.expression = new ExpressionDefinition({
            language: new LanguageExpression({
                language: "xslt",
                expression: payload.xslt,
            }),
        });
    } else {
        const parameters = { ...(clone.parameters ?? {}) };
        const knownXsltKeys = ["xslt", "xsltTemplate", "template", "stylesheet"];
        const existingKey = knownXsltKeys.find((k) => Object.prototype.hasOwnProperty.call(parameters, k));
        parameters[existingKey ?? "xslt"] = payload.xslt;
        clone.parameters = parameters;
        config.xslt = payload.xslt;
    }

    clone.note = serializeMapperConfig(clone.note, config);
    return clone as CamelElement;
};

export const applyMapperStepToIntegration = (updatedStep: CamelElement, tab: string | undefined): void => {
    const integration = useIntegrationStore.getState().integration;
    const setIntegration = useIntegrationStore.getState().setIntegration;
    const setSelectedStep = useDesignerStore.getState().setSelectedStep;
    const clone = CamelUtil.cloneIntegration(integration);
    const effectiveTab = tab ?? useDesignerStore.getState().tab ?? "routes";
    let updatedIntegration = clone;

    if (effectiveTab === "routes") {
        updatedIntegration = CamelDefinitionApiExt.updateIntegrationRouteElement(clone, updatedStep);
    } else if (effectiveTab === "rest") {
        updatedIntegration = CamelDefinitionApiExt.updateIntegrationRestElement(clone, updatedStep);
    } else if (effectiveTab === "beans") {
        updatedIntegration = CamelDefinitionApiExt.updateIntegrationBeanElement(clone, updatedStep);
    } else {
        updatedIntegration = CamelDefinitionApiExt.updateIntegrationRouteElement(clone, updatedStep);
    }

    setSelectedStep(updatedStep);
    setIntegration(updatedIntegration, false);
};

export const createKaravanMapperHost = (
    getStep: () => CamelElement | undefined,
    emit: (event: KaravanMapperHostEvent) => void,
): KaravanMapperHost => ({
    getContext: () => {
        const step = getStep();
        if (!step) {
            return null;
        }
        const { files, integrationDir } = useWorkspaceStore.getState();
        return buildMapperContext(step, files ?? [], integrationDir);
    },

    pickWorkspaceFile: (role, extensions) => {
        vscode?.postMessage({
            command: "chooseMapperWorkspaceFile",
            role,
            extensions,
        });
    },

    openXsltInEditor: (content) => {
        vscode?.postMessage({ command: "openXSLTPreview", content });
    },

    saveToActivity: (payload) => {
        const step = getStep();
        if (!step) {
            EventBus.sendAlert("Mapper", "No activity step selected. Select the Transform step again.", "warning");
            return;
        }
        if (!payload.xslt?.trim()) {
            EventBus.sendAlert("Mapper", "Generate or load XSLT before saving to the activity.", "warning");
            return;
        }
        const tab = useDesignerStore.getState().tab;
        const updated = saveMapperToActivity(step, payload);
        applyMapperStepToIntegration(updated, tab);
        const { files, integrationDir } = useWorkspaceStore.getState();
        emit({ type: "contextChanged", context: buildMapperContext(updated, files ?? [], integrationDir) });
        EventBus.sendAlert("Mapper", "XSLT saved to the activity.", "success");
    },

    subscribe: (handler) => {
        const onMessage = (event: MessageEvent) => {
            const msg = event.data;
            if (!msg?.command) {
                if (msg?.type === "xsltUpdated" && msg.content) {
                    handler({ type: "xsltUpdated", content: msg.content });
                }
                return;
            }
            switch (msg.command) {
                case "mapperWorkspaceFileSelected":
                    handler({
                        type: "workspaceFile",
                        role: msg.role,
                        relativePath: msg.relativePath,
                        content: msg.content,
                        error: msg.error,
                    });
                    break;
                case "workspaceFileContent": {
                    const step = getStep();
                    const { files, integrationDir, fileContents } = useWorkspaceStore.getState();
                    const ctx = buildMapperContext(step, files ?? [], integrationDir);
                    const path = msg.relativePath ?? msg.requestedPath;
                    let role = msg.requestedRole as "source" | "target" | "xslt" | undefined;
                    if (!role && ctx && path) {
                        if (pathsMatch(ctx.sourcePath, path)) {
                            role = "source";
                        } else if (pathsMatch(ctx.targetPath, path)) {
                            role = "target";
                        }
                    }
                    const contentFromStore =
                        typeof path === "string"
                            ? fileContents[path] ?? fileContents[normalizePath(path)]
                            : undefined;
                    if (role) {
                        handler({
                            type: "workspaceFile",
                            role,
                            relativePath: path,
                            content:
                                typeof msg.content === "string" && msg.content.length > 0
                                    ? msg.content
                                    : contentFromStore,
                            error: msg.error,
                        });
                    }
                    break;
                }
                case "mapperWorkspaceFilePickCanceled":
                    break;
                default:
                    break;
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    },
});
