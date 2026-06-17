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
import {
    getWorkspaceFileContent,
    resolvePathAgainstIntegrationDir,
    workspaceFileLookupKeys,
    coercePropertyScalar,
    storedPathForWorkspaceRequest,
} from "@/karavan/utils/workspaceFileResolver";
import { requestWriteWorkspaceFile } from "@/karavan/utils/workspaceApi";
import {
    deriveMapperPaths,
    buildMapperSourceVariables,
} from "./mapperRouteUtils";
import {
    getMapperXslt,
    isDedicatedMapperActivity,
    clearMapperNoteMarker,
    getMapperActivityDisplayName,
} from "./mapperStepUtils";
import type { Integration } from "@karavan-core/model/IntegrationDefinition";

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

const cacheWorkspaceFileContent = (bindingPath: string, content: string): void => {
    const keys = workspaceFileLookupKeys(bindingPath, null);
    const store = useWorkspaceStore.getState();
    keys.forEach((key) => store.setWorkspaceFileContent(key, content));
    window.dispatchEvent(
        new CustomEvent("karavan-workspace-file-updated", {
            detail: {
                relativePath: bindingPath,
                requestedPath: bindingPath,
                requestedRole: "xslt",
                content,
            },
        }),
    );
};

export const buildMapperContext = (
    step: CamelElement | undefined,
    workspaceFiles: string[],
    integrationDir = "",
    integration?: Integration,
): KaravanMapperContext | null => {
    if (!step) {
        return null;
    }
    const derived = deriveMapperPaths(step, integration);
    const sourcePath = derived.sourcePath;
    const targetPath = derived.targetPath;
    const xsltPath = derived.xsltBindingPath;
    const inlineXslt = getMapperXslt(step);
    const resolvedSourcePath = resolveMapperAssetPath(sourcePath, integrationDir);
    const resolvedXsltPath = resolveMapperAssetPath(xsltPath, integrationDir);
    const cachedXslt =
        inlineXslt?.trim()
        || (resolvedXsltPath ? getWorkspaceFileContent(
            resolvedXsltPath,
            workspaceFiles,
            useWorkspaceStore.getState().fileContents,
            integrationDir,
            workspaceFileLookupKeys(resolvedXsltPath, null),
        ) : undefined);
    const sourceVariables = buildMapperSourceVariables(
        integration,
        step.uuid,
        cachedXslt,
        (p) => resolveMapperAssetPath(p, integrationDir),
    );
    return {
        xslt: inlineXslt,
        activityName: getMapperActivityDisplayName(step),
        xsltPath: resolvedXsltPath,
        sourcePath: resolvedSourcePath,
        targetPath: resolveMapperAssetPath(targetPath, integrationDir),
        sourceVariables,
        workspaceXsdFiles: getWorkspaceXsdFiles(workspaceFiles),
        allowLoadXsd: isDedicatedMapperActivity(step),
    };
};

export const saveMapperToActivity = (
    mapperStep: CamelElement,
    payload: KaravanMapperSavePayload,
    integrationDir = "",
): CamelElement => {
    const clone = CamelUtil.cloneStep(mapperStep) as any;

    if (clone.dslName === "TransformDefinition") {
        clone.expression = new ExpressionDefinition({
            language: new LanguageExpression({
                language: "xslt",
                expression: payload.xslt,
            }),
        });
    } else {
        const parameters = { ...(clone.parameters ?? {}) };
        const knownXsltKeys = ["inputBinding", "xslt", "xsltTemplate", "template", "stylesheet"];
        const existingKey = knownXsltKeys.find((k) => Object.prototype.hasOwnProperty.call(parameters, k));
        const key = existingKey ?? "inputBinding";
        const prevBinding = coercePropertyScalar(parameters[key]);
        const usesFileBinding = Boolean(prevBinding && /\.(xsl|xslt)$/i.test(prevBinding));
        if (usesFileBinding) {
            parameters[key] = prevBinding;
            const storedWritePath = storedPathForWorkspaceRequest(prevBinding);
            if (storedWritePath) {
                cacheWorkspaceFileContent(prevBinding, payload.xslt);
                requestWriteWorkspaceFile(storedWritePath, payload.xslt);
            }
        } else {
            parameters[key] = payload.xslt;
        }
        clone.parameters = parameters;
    }

    clone.note = clearMapperNoteMarker((mapperStep as any)?.note);
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
        const integration = useIntegrationStore.getState().integration;
        return buildMapperContext(step, files ?? [], integrationDir, integration);
    },

    getCachedWorkspaceFile: (relativePath) => {
        const { files, integrationDir, fileContents } = useWorkspaceStore.getState();
        const keys = workspaceFileLookupKeys(relativePath, relativePath);
        return getWorkspaceFileContent(
            relativePath,
            files ?? [],
            fileContents,
            integrationDir,
            keys,
        );
    },

    notifySelectionState: (payload) => {
        vscode?.postMessage({
            command: "mapperSelectionState",
            type: "mapperSelectionState",
            payload,
        });
    },

    pickWorkspaceFile: (role, extensions) => {
        vscode?.postMessage({
            command: "chooseMapperWorkspaceFile",
            role,
            extensions,
        });
    },

    openXsltInEditor: (content) => {
        const step = getStep();
        const { files, integrationDir, integrationFullPath } = useWorkspaceStore.getState();
        const integration = useIntegrationStore.getState().integration;
        const ctx = step
            ? buildMapperContext(step, files ?? [], integrationDir, integration)
            : null;
        vscode?.postMessage({
            command: "openXSLTPreview",
            content,
            filePath: ctx?.xsltPath,
            draft: true,
            integrationDir: integrationDir || undefined,
            integrationFullPath: integrationFullPath || undefined,
        });
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
        const { integrationDir } = useWorkspaceStore.getState();
        const updated = saveMapperToActivity(step, payload, integrationDir);
        applyMapperStepToIntegration(updated, tab);
        const { files } = useWorkspaceStore.getState();
        const integration = useIntegrationStore.getState().integration;
        emit({ type: "contextChanged", context: buildMapperContext(updated, files ?? [], integrationDir, integration) });
        EventBus.sendAlert("Mapper", "XSLT applied to activity (inputBinding file updated).", "success");
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
                case "xsltUpdated":
                    if (typeof msg.content === "string" && msg.content.trim()) {
                        handler({ type: "xsltUpdated", content: msg.content });
                    }
                    break;
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
                    const { files, integrationDir } = useWorkspaceStore.getState();
                    const integration = useIntegrationStore.getState().integration;
                    const ctx = buildMapperContext(step, files ?? [], integrationDir, integration);
                    const path = msg.relativePath ?? msg.requestedPath;
                    const requestedPath = typeof msg.requestedPath === "string" ? msg.requestedPath : undefined;
                    let role = msg.requestedRole as "source" | "target" | "xslt" | undefined;
                    if (!role && ctx) {
                        const candidates = [path, requestedPath, ctx.sourcePath, ctx.targetPath, ctx.xsltPath].filter(
                            (p): p is string => typeof p === "string" && p.length > 0,
                        );
                        for (const candidate of candidates) {
                            if (pathsMatch(ctx.sourcePath, candidate)) {
                                role = "source";
                                break;
                            }
                            if (pathsMatch(ctx.targetPath, candidate)) {
                                role = "target";
                                break;
                            }
                            if (pathsMatch(ctx.xsltPath, candidate)) {
                                role = "xslt";
                                break;
                            }
                        }
                    }
                    const resolveCachedContent = (lookupPath?: string): string | undefined => {
                        if (!lookupPath) {
                            return undefined;
                        }
                        const keys = workspaceFileLookupKeys(lookupPath, path ?? null);
                        return getWorkspaceFileContent(
                            lookupPath,
                            files ?? [],
                            useWorkspaceStore.getState().fileContents,
                            integrationDir,
                            keys,
                        );
                    };
                    const content =
                        typeof msg.content === "string" && msg.content.length > 0
                            ? msg.content
                            : resolveCachedContent(path)
                            ?? resolveCachedContent(requestedPath)
                            ?? (role === "source" ? resolveCachedContent(ctx?.sourcePath) : undefined)
                            ?? (role === "target" ? resolveCachedContent(ctx?.targetPath) : undefined)
                            ?? (role === "xslt" ? resolveCachedContent(ctx?.xsltPath) : undefined);
                    if (role && content?.trim()) {
                        handler({
                            type: "workspaceFile",
                            role,
                            relativePath: path,
                            content,
                            error: msg.error,
                        });
                    }
                    break;
                }
                case "mapperWorkspaceFilePickCanceled":
                    break;
                case "workspaceFileWriteFailed":
                    EventBus.sendAlert(
                        "Mapper",
                        typeof msg.error === "string"
                            ? `Failed to save XSLT: ${msg.error}`
                            : "Failed to save XSLT to workspace file.",
                        "danger",
                    );
                    break;
                default:
                    break;
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    },
});
