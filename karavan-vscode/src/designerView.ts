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
import { CamelDefinitionYaml } from "@karavan-core/api/CamelDefinitionYaml";
import { BeanFactoryDefinition } from "@karavan-core/model/CamelDefinition";
import { Integration, KameletTypes, MetadataLabels } from "@karavan-core/model/IntegrationDefinition";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { commands, ExtensionContext, Uri, ViewColumn, WebviewPanel, WebviewPanelOnDidChangeViewStateEvent, window } from "vscode";
import { resolveStoredPath } from "./propertiesResolver";
import * as utils from "./utils";
import { getWebviewContent } from "./webviewContent";
import { getEmbeddedMapperHtml, resolveXsltMapperBuildPath } from "./xsltMapperView";

const KARAVAN_LOADED = "karavan:loaded";
const KARAVAN_PANELS: Map<string, WebviewPanel> = new Map<string, WebviewPanel>();

export class DesignerView {

    private mapperPreviewFiles: Map<string, { filePath: string, watcher?: vscode.Disposable }> = new Map();

    constructor(private context: ExtensionContext, private rootPath?: string) {

    }
    karavanOpen(fullPath: string, tab?: string) {
        utils.readFile(path.resolve(fullPath)).then(readData => {

            const yaml = Buffer.from(readData).toString('utf8');
            const filename = path.basename(fullPath);
            const relativePath = utils.getRalativePath(fullPath);
            let integration;
            try {
                integration = utils.parceYaml(filename, yaml);
            } catch (e) {
                window.showErrorMessage("Error parcing YAML!")
            } finally {
                if (integration && integration[0]) {
                    this.openKaravanWebView(filename, relativePath, fullPath, integration[1], tab);
                } else {
                    window.showErrorMessage("File is not Camel Integration!")
                }
            }
        })
    }

    getFilenameFromWebView() {
        const filename = Array.from(KARAVAN_PANELS.entries()).filter(({ 1: v }) => v.active).map(([k]) => k)[0];
        if (filename && utils.getRoot() !== undefined) {
            return filename;
        }
    }

    createIntegration(type: 'crd' | 'plain' | 'kamelet', rootPath?: string) {
        if (type === 'kamelet') {
            const kameletTypes = ["sink", "source", "action"];
            window.showQuickPick(kameletTypes, { title: "Select Type", canPickMany: false }).then((kameletType) => {
                if (kameletType) {
                    this.inputIntegrationName(type, rootPath, (kameletType as KameletTypes));
                }
            })
        } else {
            this.inputIntegrationName(type, rootPath);
        }
    }

    inputIntegrationName(type: 'crd' | 'plain' | 'kamelet', rootPath?: string, kameletType?: KameletTypes) {
        window
            .showInputBox({
                title: type === 'kamelet' ? 'Create Kamelet' : "Create Integration",
                ignoreFocusOut: true,
                prompt: type === 'kamelet' ? 'Kamelet Name' : "Integration name",
                validateInput: (text: string): string | undefined => {
                    if (!text || text.length === 0) {
                        return 'Name should not be empty';
                    } else {
                        return undefined;
                    }
                }
            }).then(value => {
                if (value) {
                    const name = utils.nameFromTitle(type, value, kameletType);
                    const filename = utils.fileNameFromName(type, name, kameletType);
                    const i: Integration = Integration.createNew(name, type);
                    if (type === 'kamelet' && i.metadata && kameletType) {
                        i.metadata.labels = new MetadataLabels({ "camel.apache.org/kamelet.type": kameletType });
                    }
                    i.type = type;
                    const yaml = CamelDefinitionYaml.integrationToYaml(i);
                    const relativePath = (this.rootPath ? rootPath?.replace(this.rootPath, "") : rootPath) + path.sep + filename;
                    const fullPath = (rootPath ? rootPath : this.rootPath) + path.sep + filename;
                    utils.save(relativePath, yaml);
                    this.openKaravanWebView(filename, filename, fullPath, yaml);
                    commands.executeCommand('integrations.refresh');
                }
            });
    }

    openKaravanWebView(filename: string, relativePath: string, fullPath: string, yaml?: string, tab?: string) {
        if (!KARAVAN_PANELS.has(relativePath)) {
            // Karavan webview
            const panel = window.createWebviewPanel(
                "karavan",
                filename,
                ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        Uri.joinPath(this.context.extensionUri, "dist"),
                    ],
                }
            );
            panel.webview.html = getWebviewContent(this.context, panel.webview);
            panel.iconPath = Uri.joinPath(
                this.context.extensionUri,
                "icons/karavan.svg"
            );

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'save':
                            utils.save(message.relativePath, message.code);
                            break;
                        case 'saveCode':
                            utils.saveCode(message.name, message.yamlFullPath, message.yamFileName, message.code);
                            break;
                        case 'savePropertyPlaceholder':
                            utils.savePropertyPlaceholder(message.key, message.value);
                            break;
                        case 'getData':
                            this.sendData(panel, filename, relativePath, fullPath, message.reread === true, yaml, tab);
                            break;
                        case 'internalConsumerClick':
                            this.internalConsumerClick(panel, fullPath, message.uri, message.name, message.routeId, message.fileName);
                            break;
                        case 'listWorkspaceFiles':
                            this.listWorkspaceFiles(panel);
                            break;
                        case 'readWorkspaceFile':
                            this.readWorkspaceFile(
                                panel,
                                message.relativePath,
                                message.integrationDir,
                                message.integrationFullPath,
                                message.candidatePaths,
                            );
                            break;
                        case 'openXSLTPreview':
                            this.openEmbeddedMapperPreview(panel, relativePath, message.content);
                            break;
                        case 'getEmbeddedMapperHtml':
                            this.sendEmbeddedMapperHtml(panel);
                            break;
                        case 'configureEmbeddedMapperPath':
                            this.configureEmbeddedMapperPath(panel);
                            break;
                        case 'chooseMapperWorkspaceFile':
                            this.chooseMapperWorkspaceFile(panel, message.role, message.extensions);
                            break;
                    }
                },
                undefined,
                this.context.subscriptions
            );
            // Handle close event
            panel.onDidDispose(() => {
                const preview = this.mapperPreviewFiles.get(relativePath);
                preview?.watcher?.dispose();
                if (preview?.filePath && fs.existsSync(preview.filePath)) {
                    fs.unlinkSync(preview.filePath);
                }
                this.mapperPreviewFiles.delete(relativePath);
                KARAVAN_PANELS.delete(relativePath);
                commands.executeCommand("setContext", KARAVAN_LOADED, false);
            }, null, this.context.subscriptions);

            // Handle reopen
            panel.onDidChangeViewState((e: WebviewPanelOnDidChangeViewStateEvent) => {
                if (e.webviewPanel.active) {
                    e.webviewPanel.webview.postMessage({ command: 'activate', tab: tab });
                } else {
                    e.webviewPanel.webview.postMessage({ command: 'deactivate' });
                }
            });

            KARAVAN_PANELS.set(relativePath, panel);
            commands.executeCommand("setContext", KARAVAN_LOADED, true);
        } else {
            const panel = KARAVAN_PANELS.get(relativePath);
            panel?.reveal(undefined, true);
            panel?.webview.postMessage({ command: 'activate', tab: tab });
        }
    }

    sendData(panel: WebviewPanel, filename: string, relativePath: string, fullPath: string, reread: boolean, yaml?: string, tab?: string) {
        Promise.all([
            // Read Kamelets
            utils.readKamelets(this.context),
            // Read components
            utils.readComponents(this.context),
            // Read templates
            utils.readTemplates(this.context),
            // Read java classes
            utils.readJavaCode(fullPath),
            // Read property placeholders
            utils.readPropertyPlaceholders(this.context),
            // Read beans
            utils.readBeans(fullPath),
            // // Read integration
            // utils.readCamelYamlFiles(path.dirname(fullPath))
        ]).then(results => {
            // Send Kamelets
            panel.webview.postMessage({ command: 'kamelets', kamelets: results[0] });
            // Send all components
            panel.webview.postMessage({ command: 'components', components: results[1] });
            // Send templates
            panel.webview.postMessage({ command: 'templates', templates: Object.fromEntries(results[2]) });
            // Send java code
            panel.webview.postMessage({ command: 'javaCode', javaCode: Object.fromEntries(results[3]) });
            this.sendIntegrationData(panel, filename, relativePath, fullPath, reread, yaml, tab, results[4], results[5]);

        }).catch(err => console.log(err));
    }

    sendIntegrationData(panel: WebviewPanel, filename: string, relativePath: string,
        fullPath: string, reread: boolean, yaml?: string, tab?: string, propertyPlaceholders?: string[], beans?: BeanFactoryDefinition[]) {
        // Read and send Integrations
        utils.readCamelYamlFiles(path.dirname(fullPath)).then((files) => {
            panel.webview.postMessage({ command: 'files', files: files });
        }).finally(() => {
            // Read file if required
            if (reread) {
                utils.readFile(path.resolve(fullPath)).then(readData => {
                    const yaml = Buffer.from(readData).toString('utf8');
                    // Send integration
                    panel.webview.postMessage(
                        {
                            command: 'open', page: "designer", filename: filename, relativePath: relativePath,
                            fullPath: fullPath, yaml: yaml, tab: tab, propertyPlaceholders: propertyPlaceholders, beans: beans
                        });
                });
            } else {
                // Send integration
                panel.webview.postMessage(
                    {
                        command: 'open', page: "designer", filename: filename, relativePath: relativePath,
                        fullPath: fullPath, yaml: yaml, tab: tab, propertyPlaceholders: propertyPlaceholders, beans: beans
                    });
            }
        })
    }

    downloadImage(fullPath: string) {
        if (fullPath.startsWith('webview-panel/webview')) {
            const filename = this.getFilenameFromWebView();
            if (filename && KARAVAN_PANELS.has(filename)) {
                const panel = KARAVAN_PANELS.get(filename);
                panel?.webview.postMessage({ command: 'downloadImage' });
            }
        }
    }

    internalConsumerClick(panel: WebviewPanel, fullPath: string, uri?: string, name?: string, routeId?: string, fileName?: string) {
        if (fileName) {
            const filename = path.join(path.dirname(fullPath), fileName);
            commands.executeCommand("karavan.open", { fsPath: filename })
        } else if (uri && name) {
            utils.getFileWithIntegnalConsumer(fullPath, uri, name).then((filename) => {
                if (filename !== undefined) {
                    commands.executeCommand("karavan.open", { fsPath: filename })
                }
            }).catch(err => window.showErrorMessage("Error: " + err?.reason));
        } else if (routeId) {
            utils.getFileWithInternalProducer(fullPath, routeId).then((filename) => {
                if (filename !== undefined) {
                    commands.executeCommand("karavan.open", { fsPath: filename })
                }
            }).catch(err => window.showErrorMessage("Error: " + err?.reason));
        }

    }

    listWorkspaceFiles(panel: WebviewPanel) {
        console.log("listWorkspaceFiles called");
        utils.listWorkspaceRelativeFiles()
            .then(files => {
                console.log("Files found:", files);
                panel.webview.postMessage({ command: 'workspaceFiles', files });
            })
            .catch(error => {
                console.error('Error listing workspace files:', error);
                panel.webview.postMessage({ command: 'workspaceFiles', files: [] });
            });
    }

    async chooseMapperWorkspaceFile(panel: WebviewPanel, role?: string, extensions?: string[]) {
        try {
            const allFiles = await utils.listWorkspaceRelativeFiles();
            const normalizedExtensions = (extensions ?? [".xsd", ".xml", ".wsdl", ".xsl", ".xslt"])
                .map((x) => x.toLowerCase());

            const filteredFiles = allFiles
                .filter((file) => {
                    const lower = file.toLowerCase();
                    return normalizedExtensions.some((ext) => lower.endsWith(ext));
                })
                .sort((a, b) => a.localeCompare(b));

            if (filteredFiles.length === 0) {
                panel.webview.postMessage({
                    command: 'mapperWorkspaceFileSelected',
                    role,
                    error: `No files found for extensions: ${normalizedExtensions.join(', ')}`,
                });
                return;
            }

            const selected = await window.showQuickPick(filteredFiles, {
                title: `Select workspace file for ${role ?? 'mapper'}`,
                canPickMany: false,
                ignoreFocusOut: true,
            });

            if (!selected) {
                panel.webview.postMessage({
                    command: 'mapperWorkspaceFilePickCanceled',
                    role,
                });
                return;
            }

            const content = await utils.readWorkspaceRelativeFile(selected);
            panel.webview.postMessage({
                command: 'mapperWorkspaceFileSelected',
                role,
                relativePath: selected,
                content,
            });
        } catch (error: any) {
            panel.webview.postMessage({
                command: 'mapperWorkspaceFileSelected',
                role,
                error: error?.message ?? String(error),
            });
        }
    }

    readWorkspaceFile(
        panel: WebviewPanel,
        relativePath: string,
        integrationDir?: string,
        integrationFullPath?: string,
        candidatePaths?: string[],
    ) {
        const candidates = utils.resolveWorkspaceFileReadCandidates(
            relativePath,
            integrationDir,
            integrationFullPath,
            candidatePaths,
        );
        console.log('[XKaravan] readWorkspaceFile', { relativePath, integrationDir, integrationFullPath, candidates });
        const tryRead = async (index: number): Promise<void> => {
            if (index >= candidates.length) {
                const err = `File not found. Tried: ${candidates.join(', ')}`;
                console.error('[XKaravan]', err);
                panel.webview.postMessage({
                    command: 'workspaceFileContent',
                    relativePath: candidates[0] ?? relativePath,
                    content: null,
                    error: err,
                });
                return;
            }
            const candidate = candidates[index];
            try {
                const content = await utils.readWorkspaceRelativeFile(candidate);
                const cacheKey = utils.asWorkspaceRelativePath(candidate);
                console.log('[XKaravan] readWorkspaceFile ok', cacheKey, `(${content.length} chars)`);
                panel.webview.postMessage({
                    command: 'workspaceFileContent',
                    relativePath: cacheKey,
                    requestedPath: relativePath,
                    content,
                });
            } catch (error) {
                console.warn(`[XKaravan] Could not read workspace file at ${candidate}:`, error);
                await tryRead(index + 1);
            }
        };
        const workspaceRoot = utils.getRoot() ?? '';
        const searchRoot = workspaceRoot
            || (integrationFullPath ? path.dirname(integrationFullPath) : '');
        if (relativePath.includes('{{') && searchRoot) {
            const stored = relativePath.startsWith('file:') ? relativePath : `file:${relativePath}`;
            void resolveStoredPath(stored, searchRoot)
                .then(async (absolute) => {
                    const content = await utils.readWorkspaceRelativeFile(absolute);
                    const cacheKey = utils.asWorkspaceRelativePath(absolute);
                    console.log('[XKaravan] readWorkspaceFile ok (placeholder)', cacheKey, `(${content.length} chars)`);
                    panel.webview.postMessage({
                        command: 'workspaceFileContent',
                        relativePath: cacheKey,
                        requestedPath: relativePath,
                        content,
                    });
                })
                .catch((err) => {
                    console.warn('[XKaravan] placeholder path resolve/read failed:', err);
                    void tryRead(0);
                });
        } else {
            void tryRead(0);
        }
    }

    async sendEmbeddedMapperHtml(panel: WebviewPanel) {
        try {
            const buildPath = await resolveXsltMapperBuildPath(false);
            if (!buildPath) {
                panel.webview.postMessage({
                    command: 'embeddedMapperHtml',
                    html: undefined,
                    error: 'XSLT mapper build path is not configured.',
                });
                return;
            }

            panel.webview.postMessage({
                command: 'embeddedMapperHtml',
                html: getEmbeddedMapperHtml(buildPath),
            });
        } catch (error: any) {
            panel.webview.postMessage({
                command: 'embeddedMapperHtml',
                html: undefined,
                error: error?.message ?? String(error),
            });
        }
    }

    async configureEmbeddedMapperPath(panel: WebviewPanel) {
        try {
            const buildPath = await resolveXsltMapperBuildPath(true);
            if (!buildPath) {
                panel.webview.postMessage({
                    command: 'embeddedMapperHtml',
                    html: undefined,
                    error: 'XSLT mapper build path is not configured.',
                });
                return;
            }
            panel.webview.postMessage({
                command: 'embeddedMapperHtml',
                html: getEmbeddedMapperHtml(buildPath),
            });
        } catch (error: any) {
            panel.webview.postMessage({
                command: 'embeddedMapperHtml',
                html: undefined,
                error: error?.message ?? String(error),
            });
        }
    }

    async openEmbeddedMapperPreview(panel: WebviewPanel, panelKey: string, content?: string) {
        if (!content) {
            window.showWarningMessage("XSLT mapper did not provide content to preview.");
            return;
        }

        try {
            const previous = this.mapperPreviewFiles.get(panelKey);
            previous?.watcher?.dispose();
            if (previous?.filePath && fs.existsSync(previous.filePath)) {
                fs.unlinkSync(previous.filePath);
            }

            const tempXsltFilePath = path.join(os.tmpdir(), `karavan-xsltmapper-${Date.now()}.xslt`);
            fs.writeFileSync(tempXsltFilePath, content, "utf8");

            const doc = await vscode.workspace.openTextDocument(tempXsltFilePath);
            await window.showTextDocument(doc, {
                preview: false,
                viewColumn: ViewColumn.Beside,
            });

            const watcher = vscode.workspace.onDidSaveTextDocument((savedDoc) => {
                if (savedDoc.uri.fsPath === tempXsltFilePath) {
                    const updated = fs.readFileSync(tempXsltFilePath, "utf8");
                    panel.webview.postMessage({
                        command: 'xsltUpdated',
                        content: updated,
                    });
                }
            });

            this.mapperPreviewFiles.set(panelKey, { filePath: tempXsltFilePath, watcher });
        } catch (error: any) {
            window.showErrorMessage(`Failed to open XSLT preview: ${error?.message ?? error}`);
        }
    }

    async handleDynamicFileContent(code: string): Promise<string> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage("No workspace folder is open.");
                return code; // Return the original code if no workspace is open
            }

            // Resolve the full path of the file
            const fullPath = path.join(workspaceFolder.uri.fsPath, code);

            // Check if the path exists and is a file
            if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
                // Read the file content
                const fileContent = fs.readFileSync(fullPath, "utf8");
                return fileContent; // Return the file content
            } else {
                return code; // Return the original code if it's not a valid file
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to handle file content: ${message}`);
            return code; // Return the original code in case of an error
        }
    }
}