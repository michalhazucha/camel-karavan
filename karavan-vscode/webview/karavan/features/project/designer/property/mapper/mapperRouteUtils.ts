import type { KaravanSourceVariable } from "@karavan/mapper-core";
import { CamelDefinitionApiExt } from "@karavan-core/api/CamelDefinitionApiExt";
import { CamelUtil } from "@karavan-core/api/CamelUtil";
import { ToDefinition } from "@karavan-core/model/CamelDefinition";
import { CamelElement, Integration } from "@karavan-core/model/IntegrationDefinition";
import { coercePropertyScalar } from "@/karavan/utils/workspaceFileResolver";
import {
    parseMapperConfig,
    sanitizeActivityFileName,
    sanitizeVariableReceive,
    serializeMapperConfig,
} from "./mapperStepUtils";

export const MAPPER_KAMELET_URI = "kamelet:activity-mapper-action";

export interface UpstreamSchemaRef {
    /** Karavan step variableReceive (activity id), e.g. Assign-messageId. */
    variableReceive: string;
    /** BW5 binding name used in XSLT ($messageVar) — from parameters.variableName when set. */
    bindingName: string;
    storedPath: string;
}

export const isMapperKameletUri = (uri?: string): boolean => {
    if (!uri) {
        return false;
    }
    const lower = uri.toLowerCase();
    if (lower === MAPPER_KAMELET_URI) {
        return true;
    }
    return lower.startsWith("kamelet:") && /(mapper|transform-xml|xslt)/.test(lower);
};

const schemaPathFromStep = (step: any): string => {
    const params = step?.parameters ?? {};
    return (
        coercePropertyScalar(params.outputSchema)
        || coercePropertyScalar(params.variableSchema)
        || coercePropertyScalar(params.inputSchema)
        || ""
    );
};

const bindingNameFromStep = (step: any): string => {
    const params = step?.parameters ?? {};
    const variableName = coercePropertyScalar(params.variableName);
    if (variableName) {
        return variableName.replace(/^\$/, "");
    }
    const vr: string = step?.variableReceive ?? step?.name ?? "";
    return vr.replace(/^\$/, "");
};

/** Collect `xsl:param @name` values from XSLT text (no DOM). */
export const extractXsltParamNames = (xsltContent: string): string[] => {
    if (!xsltContent?.trim()) {
        return [];
    }
    const names = new Set<string>();
    const paramPattern = /<xsl:param\b[^>]*\bname=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = paramPattern.exec(xsltContent)) !== null) {
        const name = match[1]?.trim();
        if (name) {
            names.add(name.replace(/^\$/, ""));
        }
    }
    return [...names];
};

/**
 * BW5 routes use global variable scope — collect every variableReceive in the route
 * except the selected mapper step itself.
 */
export const getUpstreamStepSchemas = (
    integration: Integration,
    selectedStepUuid: string,
): UpstreamSchemaRef[] => {
    const result: UpstreamSchemaRef[] = [];
    const seen = new Set<string>();

    const walk = (step: any): void => {
        if (!step || typeof step !== "object") {
            return;
        }
        if (step.uuid === selectedStepUuid) {
            return;
        }
        const dslName = String(step.dslName ?? "");
        if (dslName === "SetVariableDefinition" || dslName === "setVariable") {
            const name: string = step.name ?? "";
            const bindingName = bindingNameFromStep(step);
            const dedupeKey = bindingName || name;
            if (dedupeKey && !seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                result.push({
                    variableReceive: name ? `$${name}` : `$${bindingName}`,
                    bindingName: bindingName || name,
                    storedPath: "",
                });
            }
        } else {
            const vr: string = step.variableReceive ?? "";
            const bindingName = bindingNameFromStep(step);
            const dedupeKey = bindingName || vr;
            if (dedupeKey && !seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                result.push({
                    variableReceive: vr ? `$${vr.replace(/^\$/, "")}` : `$${bindingName}`,
                    bindingName,
                    storedPath: schemaPathFromStep(step),
                });
            }
        }
        for (const val of Object.values(step)) {
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && typeof item === "object") {
                        walk(item);
                    }
                }
            } else if (val && typeof val === "object") {
                walk(val as any);
            }
        }
    };

    for (const flow of (integration as any).spec?.flows ?? []) {
        const from = flow?.from;
        if (!from) {
            continue;
        }
        walk(from);
    }
    return result;
};

/** Merge upstream step variables with xsl:param names for mapper source panel. */
export const buildMapperSourceVariables = (
    integration: Integration | undefined,
    stepUuid: string | undefined,
    xsltContent?: string,
    resolvePath?: (path: string | undefined) => string | undefined,
): KaravanSourceVariable[] => {
    const resolve = resolvePath ?? ((p) => p);
    const upstream = integration && stepUuid ? getUpstreamStepSchemas(integration, stepUuid) : [];
    const paramNames = xsltContent ? extractXsltParamNames(xsltContent) : [];
    const byBinding = new Map<string, KaravanSourceVariable>();

    for (const entry of upstream) {
        const bindingName = entry.bindingName;
        byBinding.set(bindingName, {
            variableReceive: `$${bindingName}`,
            bindingName,
            stepVariableReceive: entry.variableReceive,
            schemaPath: resolve(entry.storedPath),
            kind: "upstream",
        });
    }

    for (const param of paramNames) {
        if (byBinding.has(param)) {
            continue;
        }
        byBinding.set(param, {
            variableReceive: `$${param}`,
            bindingName: param,
            kind: "xslt-param",
        });
    }

    return [...byBinding.values()];
};

export const getKameletParameterPath = (step: CamelElement, ...keys: string[]): string => {
    const params = (step as any)?.parameters ?? {};
    for (const key of keys) {
        const value = coercePropertyScalar(params[key]);
        if (value) {
            return value;
        }
    }
    return "";
};

export interface DerivedMapperPaths {
    sourcePath?: string;
    targetPath?: string;
    xsltBindingPath?: string;
}

/**
 * TIBCO-like defaults: target from outputSchema / note; source from upstream steps;
 * XSLT from inputBinding (BW5 kamelet) or inline expression.
 */
export const deriveMapperPaths = (
    step: CamelElement,
    integration?: Integration,
): DerivedMapperPaths => {
    const noteConfig = parseMapperConfig((step as any)?.note);
    const description =
        ((step as any)?.description as string | undefined)?.trim()
        || ((step as any)?.id as string | undefined)?.trim()
        || "activity";
    const sanitized = sanitizeActivityFileName(description);
    const variableReceive = (step as any)?.variableReceive as string | undefined;

    let targetPath = noteConfig.targetPath?.trim();
    if (!targetPath) {
        const inputSchema = getKameletParameterPath(step, "inputSchema");
        if (inputSchema) {
            targetPath = inputSchema;
        } else {
            const binding = getKameletParameterPath(step, "inputBinding");
            if (binding) {
                const xsdFromBinding = binding
                    .replace(/\/xslt\//gi, "/xsd/")
                    .replace(/\\xslt\\/gi, "\\xsd\\");
                if (xsdFromBinding !== binding) {
                    targetPath = xsdFromBinding;
                }
            }
        }
        if (!targetPath) {
            targetPath =
                getKameletParameterPath(step, "outputSchema", "variableSchema")
                || (variableReceive ? `xsd/${variableReceive.replace(/-/g, "_")}_input.xsd` : `xsd/${sanitized}_input.xsd`);
        }
    }

    let sourcePath = noteConfig.sourcePath?.trim();
    if (!sourcePath && integration && step.uuid) {
        const upstream = getUpstreamStepSchemas(integration, step.uuid);
        const withSchema = upstream.filter((u) => u.storedPath);
        if (withSchema.length > 0) {
            // Prefer the last upstream step that declares a schema (closest to mapper in BW5 flows).
            sourcePath = withSchema[withSchema.length - 1].storedPath;
        } else if (upstream.length > 0) {
            const vr = upstream[upstream.length - 1].variableReceive.replace(/^\$/, "");
            sourcePath = `xsd/${vr.replace(/-/g, "_")}_input.xsd`;
        }
    }
    if (!sourcePath) {
        sourcePath = `xsd/${sanitized}_input.xsd`;
    }

    const xsltBindingPath =
        getKameletParameterPath(step, "inputBinding", "xslt", "xsltTemplate", "template", "stylesheet")
        || noteConfig.xslt
        || `xslt/${sanitized}_input.xslt`;

    return { sourcePath, targetPath, xsltBindingPath };
};

/**
 * @deprecated Do not persist to YAML — buildMapperContext uses deriveMapperPaths at runtime.
 * Kept for backwards compatibility if a step already has an explicit note override.
 */
export const ensureMapperNoteConfig = (
    step: CamelElement,
    integration?: Integration,
): CamelElement | null => {
    const existing = parseMapperConfig((step as any)?.note);
    if (existing.sourcePath?.trim() && existing.targetPath?.trim()) {
        return null;
    }
    const derived = deriveMapperPaths(step, integration);
    const nextNote = serializeMapperConfig((step as any)?.note, {
        sourcePath: existing.sourcePath?.trim() || derived.sourcePath,
        targetPath: existing.targetPath?.trim() || derived.targetPath,
        xslt: existing.xslt,
    });
    if (nextNote === (step as any)?.note) {
        return null;
    }
    const clone = CamelUtil.cloneStep(step) as any;
    clone.note = nextNote;
    return clone as CamelElement;
};

export const applyMapperKameletDefaults = (step: CamelElement, uri?: string): CamelElement => {
    if (!isMapperKameletUri(uri)) {
        return step;
    }
    const to = step as ToDefinition & { parameters?: Record<string, unknown>; description?: string };
    const activityName = to.description?.trim() || "Map Data";
    const sanitized = sanitizeActivityFileName(activityName);
    if (!to.description) {
        to.description = activityName;
    }
    if (!(to as any).variableReceive) {
        (to as any).variableReceive = sanitizeVariableReceive(activityName);
    }
    to.parameters = { ...(to.parameters ?? {}) };
    if (!coercePropertyScalar(to.parameters.inputBinding)) {
        to.parameters.inputBinding = `file:xslt/${sanitized}_input.xslt`;
    }
    if (!coercePropertyScalar(to.parameters.outputSchema)) {
        to.parameters.outputSchema = `file:xsd/${sanitized}_output.xsd`;
    }
    const derived = deriveMapperPaths(to);
    const note = serializeMapperConfig((to as any).note, {
        sourcePath: derived.sourcePath,
        targetPath: derived.targetPath,
    });
    if (note) {
        (to as any).note = note;
    }
    return step;
};

export const findMapperStepInIntegration = (
    integration: Integration,
    uuid?: string,
): CamelElement | undefined => {
    if (!uuid) {
        return undefined;
    }
    return CamelDefinitionApiExt.findElementInIntegration(integration, uuid);
};
