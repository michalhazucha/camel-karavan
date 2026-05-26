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

const isKameletMapperUri = (uri?: string): boolean => {
    if (!uri) {
        return false;
    }
    const lower = uri.toLowerCase();
    return lower.startsWith("kamelet:") && /(mapper|transform-xml|xslt)/.test(lower);
};

export const getMapperXslt = (step?: CamelElement): string => {
    const noteConfig = parseMapperConfig((step as any)?.note);
    if (noteConfig.xslt) {
        return noteConfig.xslt;
    }
    const expression = (step as any)?.expression as ExpressionDefinition | undefined;
    const language = expression?.language as LanguageExpression | undefined;
    if (language?.expression) {
        const lang = (language.language ?? "").toLowerCase();
        if (lang === "xslt" || lang === "" || lang === "language") {
            return language.expression;
        }
    }
    return "";
};

export const isMapperStep = (step: unknown): boolean => {
    if (!step) {
        return false;
    }
    const s = step as CamelElement;
    if (s.dslName === "TransformDefinition") {
        return true;
    }
    if ((s.dslName === "ToDefinition" || s.dslName === "ToDynamicDefinition") && isKameletMapperUri((s as ToDefinition)?.uri)) {
        return true;
    }
    const expressionLanguage = (s as any)?.expression?.language?.language;
    return expressionLanguage === "xslt" || Object.keys(parseMapperConfig((s as any).note)).length > 0;
};
