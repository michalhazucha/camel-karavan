import {
    ExpressionDefinition,
    LanguageExpression,
    ToDefinition,
} from "@karavan-core/model/CamelDefinition";
import { CamelElement } from "@karavan-core/model/IntegrationDefinition";

export type MapperConfig = {
    sourcePath?: string;
    targetPath?: string;
    xslt?: string;
};

export const MAPPER_NOTE_PREFIX = "[karavan-xslt-mapper]";

const looksLikeResourcePath = (value: string): boolean =>
    /^file:/i.test(value.trim())
    || /\{\{project\.root\./i.test(value)
    || /\.(xslt?|xsd|xml|wsdl)$/i.test(value.trim());

export const sanitizeActivityFileName = (name: string): string => name.trim().replace(/\s+/g, "_");

export const sanitizeVariableReceive = (name: string): string => name.trim().replace(/\s+/g, "-");

export const parseMapperConfig = (note?: string): MapperConfig => {
    if (!note) {
        return {};
    }
    const markerIndex = note.indexOf(MAPPER_NOTE_PREFIX);
    if (markerIndex === -1) {
        return {};
    }
    const jsonText = note.substring(markerIndex + MAPPER_NOTE_PREFIX.length).trim();
    if (!jsonText) {
        return {};
    }
    try {
        return JSON.parse(jsonText) as MapperConfig;
    } catch {
        return {};
    }
};

export const serializeMapperConfig = (note: string | undefined, config: MapperConfig): string | undefined => {
    const baseNote = (note ?? "").split(MAPPER_NOTE_PREFIX)[0].trim();
    const hasConfig = Boolean(config.sourcePath || config.targetPath || config.xslt);
    if (!hasConfig) {
        return baseNote || undefined;
    }
    const serializedConfig = `${MAPPER_NOTE_PREFIX}${JSON.stringify(config)}`;
    return [baseNote, serializedConfig].filter(Boolean).join("\n");
};

/** Remove Karavan mapper metadata from step note; keep human-authored note text. */
export const clearMapperNoteMarker = (note?: string): string | undefined => {
    if (!note?.trim()) {
        return undefined;
    }
    const base = note.split(MAPPER_NOTE_PREFIX)[0].trim();
    return base || undefined;
};

const getStepInputBinding = (step?: CamelElement): string => {
    const params = (step as { parameters?: Record<string, unknown> } | undefined)?.parameters ?? {};
    const binding = params.inputBinding;
    if (typeof binding === "string") {
        return binding.trim();
    }
    if (binding && typeof binding === "object" && "expression" in (binding as object)) {
        return String((binding as { expression?: string }).expression ?? "").trim();
    }
    return "";
};

export const isKameletMapperUri = (uri?: string): boolean => {
    if (!uri) {
        return false;
    }
    const lower = uri.toLowerCase();
    if (lower === "kamelet:activity-mapper-action") {
        return true;
    }
    return lower.startsWith("kamelet:") && /(mapper|transform-xml|xslt)/.test(lower);
};

/** Dedicated Mapper / XSLT step — Load XSD is only offered here (not on CallProcess / JMS). */
export const isDedicatedMapperActivity = (step: unknown): boolean => {
    if (!step) {
        return false;
    }
    const s = step as CamelElement;
    if (s.dslName === "TransformDefinition") {
        return true;
    }
    if (
        (s.dslName === "ToDefinition" || s.dslName === "ToDynamicDefinition")
        && isKameletMapperUri((s as ToDefinition)?.uri)
    ) {
        return true;
    }
    const expressionLanguage = (s as any)?.expression?.language?.language;
    return expressionLanguage === "xslt";
};

/** BW5/TIBCO: any kamelet step with parameters.inputBinding is a mapper (CallProcess, JMS, RV reply, …). */
export const hasInputBinding = (step: unknown): boolean => {
    if (!step || typeof step !== "object") {
        return false;
    }
    const params = (step as { parameters?: Record<string, unknown> }).parameters ?? {};
    const binding = params.inputBinding;
    if (typeof binding === "string") {
        return binding.trim().length > 0;
    }
    if (binding && typeof binding === "object" && "expression" in (binding as object)) {
        const expr = String((binding as { expression?: string }).expression ?? "").trim();
        return expr.length > 0;
    }
    return false;
};

export const getMapperXslt = (step?: CamelElement): string => {
    const fileBinding = getStepInputBinding(step);
    if (fileBinding && /\.(xsl|xslt)$/i.test(fileBinding)) {
        return "";
    }
    const noteConfig = parseMapperConfig((step as any)?.note);
    const expression = (step as any)?.expression as ExpressionDefinition | undefined;
    const language = expression?.language as LanguageExpression | undefined;
    const lang = (language?.language ?? "").toLowerCase();
    const inline =
        language?.expression &&
        (lang === "xslt" || lang === "" || lang === "language")
            ? language.expression
            : "";

    // Prefer the inline DSL expression — that is what Camel runs. A copy in `note` can be stale
    // (e.g. after "Save to Activity" updated only expression, or older saves duplicated xslt in note).
    if (inline?.trim() && !looksLikeResourcePath(inline)) {
        return inline;
    }
    if (noteConfig.xslt?.trim() && !looksLikeResourcePath(noteConfig.xslt)) {
        return noteConfig.xslt;
    }
    return "";
};

export const isMapperStep = (step: unknown): boolean => {
    if (!step) {
        return false;
    }
    const s = step as CamelElement;
    if (hasInputBinding(step)) {
        return true;
    }
    if (s.dslName === "TransformDefinition") {
        return true;
    }
    if ((s.dslName === "ToDefinition" || s.dslName === "ToDynamicDefinition") && isKameletMapperUri((s as ToDefinition)?.uri)) {
        return true;
    }
    const expressionLanguage = (s as any)?.expression?.language?.language;
    return expressionLanguage === "xslt";
};
