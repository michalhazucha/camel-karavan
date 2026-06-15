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
import * as vscode from 'vscode';
import * as path from 'path';

async function findPropertiesFile(startDir: string): Promise<{ filePath: string; dir: string } | null> {
    let dir = startDir;
    for (;;) {
        const candidate = path.resolve(dir, 'application.properties');
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
            return { filePath: candidate, dir };
        } catch {
            const parent = path.dirname(dir);
            if (parent === dir) return null;
            dir = parent;
        }
    }
}

async function loadProjectRoots(propertiesSearchDir: string): Promise<Map<string, string>> {
    const roots = new Map<string, string>();
    try {
        const found = await findPropertiesFile(propertiesSearchDir);
        if (!found) return roots;
        const data = await vscode.workspace.fs.readFile(vscode.Uri.file(found.filePath));
        const text = Buffer.from(data).toString('utf8');
        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 0) continue;
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (key.startsWith('project.root.')) {
                // Resolve relative values against the properties file's own directory.
                roots.set(key, path.isAbsolute(val) ? val : path.resolve(found.dir, val));
            }
        }
    } catch {
        // application.properties not found or unreadable — caller receives empty substitution
    }
    return roots;
}

/**
 * Converts an absolute path back to stored-path form using the nearest matching
 * project.root.* prefix from application.properties.
 * Falls back to `file:` + absolutePath when no placeholder matches.
 */
export async function makeStoredValue(
    absolutePath: string,
    workspaceRoot: string,
    propertiesSearchDir?: string,
): Promise<string> {
    const roots = await loadProjectRoots(propertiesSearchDir ?? workspaceRoot);
    for (const [key, val] of roots) {
        if (val && absolutePath.startsWith(val)) {
            return 'file:{{' + key + '}}' + absolutePath.slice(val.length);
        }
    }
    return 'file:' + absolutePath;
}

/**
 * Resolves a stored path (e.g. `file:{{project.root.poc}}/Order.xsd`) to an
 * absolute filesystem path by stripping the `file:` prefix and substituting all
 * `{{project.root.*}}` placeholders using values from application.properties.
 */
export async function resolveStoredPath(
    storedPath: string,
    workspaceRoot: string,
    propertiesSearchDir?: string,
): Promise<string> {
    let resolved = storedPath.startsWith('file:') ? storedPath.slice(5) : storedPath;
    const roots = await loadProjectRoots(propertiesSearchDir ?? workspaceRoot);
    for (const [key, val] of roots) {
        resolved = resolved.split('{{' + key + '}}').join(val);
    }
    if (!path.isAbsolute(resolved)) {
        resolved = path.resolve(workspaceRoot, resolved);
    }
    return resolved;
}
