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

export const resolveBoundFileName = (value: unknown, inputLanguage?: string): string | null => {
    const raw = value?.toString().trim() ?? '';
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

export const resolveWorkspaceRelativePaths = (fileName: string, workspaceFiles: string[]): string[] => {
    const paths = new Set<string>([fileName]);
    workspaceFiles
        .filter((path) => path === fileName || path.endsWith(`/${fileName}`) || path.endsWith(`\\${fileName}`))
        .forEach((path) => paths.add(path));
    return Array.from(paths);
};

export const getWorkspaceFileContent = (
    fileName: string,
    workspaceFiles: string[],
    workspaceFileContents: Record<string, string>,
): string | undefined => {
    for (const path of resolveWorkspaceRelativePaths(fileName, workspaceFiles)) {
        const content = workspaceFileContents[path];
        if (content !== undefined) {
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
): string => {
    const fileName = resolveBoundFileName(customCode, inputLanguage);
    if (!fileName) {
        return customCode?.toString() ?? '';
    }
    const fromIntegration = integrationFiles.find((file) => file.name === fileName)?.code;
    if (fromIntegration !== undefined) {
        return fromIntegration;
    }
    const fromWorkspace = getWorkspaceFileContent(fileName, workspaceFiles, workspaceFileContents);
    if (fromWorkspace !== undefined) {
        return fromWorkspace;
    }
    return '';
};
