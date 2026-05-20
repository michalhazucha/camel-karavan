/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const FILE_PREFIX = 'resource:';

const RESOURCE_FILE_PATTERN = /\.(xslt?|xml|json|properties|sql|java|jsonata|groovy|js|yaml|yml)$/i;

const SCALAR_OBJECT_KEYS = [
    'resourceUri',
    'value',
    'expression',
    'constant',
    'script',
    'template',
    'uri',
    'name',
    'message',
    'query',
];

const decodeBinaryContent = (value: unknown): string | undefined => {
    if (value instanceof Uint8Array) {
        return new TextDecoder('utf-8').decode(value);
    }
    if (value instanceof ArrayBuffer) {
        return new TextDecoder('utf-8').decode(value);
    }
    if (typeof value === 'object' && value !== null) {
        const obj = value as Record<string, unknown>;
        // Node Buffer / VS Code postMessage serialization: { type: 'Buffer', data: number[] }
        if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
            return new TextDecoder('utf-8').decode(new Uint8Array(obj.data as number[]));
        }
        if (Array.isArray(obj.data) && obj.data.every((n) => typeof n === 'number')) {
            return new TextDecoder('utf-8').decode(new Uint8Array(obj.data as number[]));
        }
    }
    return undefined;
};

/**
 * Normalizes property / parameter values that may be plain strings or Camel DSL objects.
 * Never returns "[object Object]" or the literal "Buffer".
 */
export const coercePropertyScalar = (value: unknown): string => {
    if (value === null || value === undefined) {
        return '';
    }
    const fromBinary = decodeBinaryContent(value);
    if (fromBinary !== undefined) {
        return fromBinary;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '[object Object]' || trimmed === 'Buffer') {
            return '';
        }
        return trimmed;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (obj.type === 'Buffer') {
            return '';
        }
        for (const key of SCALAR_OBJECT_KEYS) {
            const nested = obj[key];
            if (typeof nested === 'string') {
                const t = nested.trim();
                if (t && t !== '[object Object]' && t !== 'Buffer') {
                    return t;
                }
            }
        }
        const stringValues = Object.values(obj).filter(
            (v): v is string =>
                typeof v === 'string'
                && v.trim() !== ''
                && v.trim() !== '[object Object]'
                && v.trim() !== 'Buffer',
        );
        if (stringValues.length === 1) {
            return stringValues[0].trim();
        }
    }
    return '';
};

/** Editor / Monaco value must always be a plain string. */
export const ensureEditorString = (value: unknown): string => {
    const fromBinary = decodeBinaryContent(value);
    if (fromBinary !== undefined) {
        return fromBinary;
    }
    if (typeof value === 'string') {
        const t = value;
        if (t === '[object Object]' || t === 'Buffer') {
            return '';
        }
        return t;
    }
    return coercePropertyScalar(value);
};

export const integrationDirFromRelativePath = (integrationRelativePath?: string): string => {
    if (!integrationRelativePath) {
        return '';
    }
    const normalized = integrationRelativePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx >= 0 ? normalized.slice(0, idx) : '';
};

export const resolveBoundFileName = (value: unknown, inputLanguage?: string): string | null => {
    const raw = coercePropertyScalar(value);
    if (!raw || raw.includes('{{') || raw.includes('\n')) {
        return null;
    }
    if (raw.startsWith(FILE_PREFIX)) {
        return raw.slice(FILE_PREFIX.length);
    }
    if (inputLanguage && raw.endsWith(`.${inputLanguage}`)) {
        return raw;
    }
    if (RESOURCE_FILE_PATTERN.test(raw)) {
        return raw;
    }
    return null;
};

const pathDepth = (p: string): number => p.split(/[/\\]/).filter(Boolean).length;

const joinRelative = (dir: string, fileName: string): string => {
    const d = dir.replace(/\\/g, '/').replace(/\/$/, '');
    return d ? `${d}/${fileName}` : fileName;
};

export const resolveWorkspaceRelativePaths = (
    fileName: string,
    workspaceFiles: string[],
    integrationDir?: string,
): string[] => {
    const paths = new Set<string>();
    const dir = integrationDir?.replace(/\\/g, '/').replace(/\/$/, '') ?? '';
    if (dir) {
        paths.add(joinRelative(dir, fileName));
    }
    paths.add(fileName);
    workspaceFiles
        .filter((path) => path === fileName || path.endsWith(`/${fileName}`) || path.endsWith(`\\${fileName}`))
        .forEach((path) => paths.add(path));
    return Array.from(paths).sort((a, b) => {
        const aInIntegration = dir && a.startsWith(dir + '/');
        const bInIntegration = dir && b.startsWith(dir + '/');
        if (aInIntegration !== bInIntegration) {
            return aInIntegration ? -1 : 1;
        }
        return pathDepth(b) - pathDepth(a) || b.length - a.length;
    });
};

export const getWorkspaceFileContent = (
    fileName: string,
    workspaceFiles: string[],
    workspaceFileContents: Record<string, string>,
    integrationDir?: string,
): string | undefined => {
    for (const path of resolveWorkspaceRelativePaths(fileName, workspaceFiles, integrationDir)) {
        const content = workspaceFileContents[path];
        if (typeof content === 'string' && content.length > 0 && content !== '[object Object]') {
            return content;
        }
    }
    return undefined;
};

export const resolveEditorContent = (
    customCode: unknown,
    integrationFiles: { name: string; code: string }[],
    workspaceFiles: string[],
    workspaceFileContents: Record<string, string>,
    inputLanguage?: string,
    integrationDir?: string,
): string => {
    const fileName = resolveBoundFileName(customCode, inputLanguage);
    if (!fileName) {
        return ensureEditorString(customCode);
    }
    const fromIntegration = integrationFiles.find((file) => file.name === fileName)?.code;
    if (typeof fromIntegration === 'string' && fromIntegration.length > 0 && fromIntegration !== '[object Object]') {
        return fromIntegration;
    }
    const fromWorkspace = getWorkspaceFileContent(fileName, workspaceFiles, workspaceFileContents, integrationDir);
    if (fromWorkspace !== undefined) {
        return fromWorkspace;
    }
    return '';
};

/** Monaco / editor language id from a resource file name. */
export const editorLanguageFromFileName = (fileName: string): string => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.xsl') || lower.endsWith('.xslt')) {
        return 'xml';
    }
    if (lower.endsWith('.xml')) {
        return 'xml';
    }
    if (lower.endsWith('.json')) {
        return 'json';
    }
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
        return 'yaml';
    }
    if (lower.endsWith('.sql')) {
        return 'sql';
    }
    if (lower.endsWith('.groovy')) {
        return 'groovy';
    }
    if (lower.endsWith('.js')) {
        return 'javascript';
    }
    if (lower.endsWith('.java')) {
        return 'java';
    }
    if (lower.endsWith('.properties')) {
        return 'ini';
    }
    return 'plaintext';
};
