import { requestWorkspaceFile } from "@/karavan/utils/workspaceApi";
import vscode from "@/vscode";
import { CamelDefinitionApiExt } from "@karavan-core/api/CamelDefinitionApiExt";
import { CamelUtil } from "@karavan-core/api/CamelUtil";
import {
    ExpressionDefinition,
    LanguageExpression,
    ToDefinition
} from "@karavan-core/model/CamelDefinition";
import { CamelElement } from "@karavan-core/model/IntegrationDefinition";
import { Alert, Form, FormGroup, Title } from "@patternfly/react-core";
import { useWorkspaceStore } from "@stores/workspaceStore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { shallow } from "zustand/shallow";
import { useDesignerStore, useIntegrationStore } from "../DesignerStore";
import "./MapperPanel.shadcn.css";

type MapperNode = {
    id: string;
    name: string;
    path: string;
    type: string;
    children: MapperNode[];
};

type MapperConnection = {
    id: string;
    sourcePath: string;
    targetPath: string;
    transformationType?: MapperTransformationType;
    expression?: string;
    condition?: string;
    thenExpression?: string;
    elseExpression?: string;
    variableName?: string;
    variableExpression?: string;
    hardcodedValue?: string;
};

type MapperViewMode = "tree" | "flow";

type MapperTransformationType =
    | "direct"
    | "function"
    | "concat"
    | "conditional"
    | "variable"
    | "inline-variable"
    | "nested-variable"
    | "logger"
    | "substring";

type MapperProjectState = {
    version: "1";
    sourcePath?: string;
    targetPath?: string;
    xsltText?: string;
    connections: MapperConnection[];
};

type ConnectionLine = {
    id: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
};

type MapperConfig = {
    sourcePath?: string;
    targetPath?: string;
    xslt?: string;
};

const MAPPER_NOTE_PREFIX = "[karavan-xslt-mapper]";
const MAPPER_COLORS = ["#2b9af3", "#6f42c1", "#00b894", "#f39c12", "#e74c3c", "#1abc9c", "#8e44ad"];

function parseXsdNodes(xsdContent: string, fallbackRootName: string): MapperNode[] {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xsdContent, "application/xml");
    const parseError = xml.querySelector("parsererror");
    if (parseError) {
        throw new Error("Invalid XSD content.");
    }

    const schema = xml.documentElement;
    const nodeId = (() => {
        let counter = 0;
        return () => `node-${counter++}`;
    })();

    const findTypeDefinition = (typeName: string): Element | null => {
        const localType = typeName.includes(":") ? typeName.split(":")[1] : typeName;
        if (!localType) {
            return null;
        }
        const defs = schema.querySelectorAll("xs\\:complexType[name], xsd\\:complexType[name], complexType[name]");
        for (const def of Array.from(defs)) {
            if (def.getAttribute("name") === localType) {
                return def as Element;
            }
        }
        return null;
    };

    const parseElement = (el: Element, parentPath: string): MapperNode | null => {
        const name = el.getAttribute("name");
        if (!name) {
            return null;
        }
        const path = parentPath ? `${parentPath}/${name}` : name;
        const type = el.getAttribute("type") || "string";

        const children: MapperNode[] = [];
        const complexType = el.querySelector(":scope > xs\\:complexType, :scope > xsd\\:complexType, :scope > complexType");
        const sequence = complexType?.querySelector(":scope > xs\\:sequence, :scope > xsd\\:sequence, :scope > sequence");
        const childrenEls = sequence?.querySelectorAll(":scope > xs\\:element, :scope > xsd\\:element, :scope > element") || [];
        Array.from(childrenEls).forEach((childEl) => {
            const child = parseElement(childEl as Element, path);
            if (child) {
                children.push(child);
            }
        });

        if (!complexType && type && !type.startsWith("xs:") && !type.startsWith("xsd:")) {
            const ref = findTypeDefinition(type);
            if (ref) {
                const refSeq = ref.querySelector(":scope > xs\\:sequence, :scope > xsd\\:sequence, :scope > sequence");
                const refEls = refSeq?.querySelectorAll(":scope > xs\\:element, :scope > xsd\\:element, :scope > element") || [];
                Array.from(refEls).forEach((childEl) => {
                    const child = parseElement(childEl as Element, path);
                    if (child) {
                        children.push(child);
                    }
                });
            }
        }

        return {
            id: nodeId(),
            name,
            path,
            type,
            children,
        };
    };

    const rootEls = schema.querySelectorAll(":scope > xs\\:element, :scope > xsd\\:element, :scope > element");
    const roots: MapperNode[] = [];
    Array.from(rootEls).forEach((el) => {
        const node = parseElement(el as Element, "");
        if (node) {
            roots.push(node);
        }
    });

    if (roots.length > 0) {
        return roots;
    }

    return [{
        id: "fallback-root",
        name: fallbackRootName,
        path: fallbackRootName,
        type: "string",
        children: [],
    }];
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function buildXsltFromMappings(connections: MapperConnection[]): string {
    const body = connections.map(c => {
        const targetElement = c.targetPath.split("/").filter(Boolean).pop() || "target";
        const t = c.transformationType || "direct";
        if (t === "conditional" && c.condition) {
            const thenExpr = c.thenExpression || c.sourcePath;
            const elseExpr = c.elseExpression;
            const elseBlock = elseExpr
                ? `\n      <xsl:otherwise><${targetElement}><xsl:value-of select="${escapeXml(elseExpr)}"/></${targetElement}></xsl:otherwise>`
                : "";
            return `    <xsl:choose>\n      <xsl:when test="${escapeXml(c.condition)}"><${targetElement}><xsl:value-of select="${escapeXml(thenExpr)}"/></${targetElement}></xsl:when>${elseBlock}\n    </xsl:choose>`;
        }

        if (t === "variable" && c.variableName && c.variableExpression) {
            const expr = c.expression || `$${c.variableName}`;
            return `    <xsl:variable name="${escapeXml(c.variableName)}" select="${escapeXml(c.variableExpression)}"/>\n    <${targetElement}><xsl:value-of select="${escapeXml(expr)}"/></${targetElement}>`;
        }

        if (t === "inline-variable" && c.variableName && c.variableExpression) {
            const expr = c.expression || `$${c.variableName}`;
            return `    <${targetElement}><xsl:value-of select="${escapeXml(expr)}"/></${targetElement}>\n    <xsl:variable name="${escapeXml(c.variableName)}" select="${escapeXml(c.variableExpression)}"/>`;
        }

        if (t === "nested-variable" && c.variableName && c.variableExpression) {
            const expr = c.expression || `$${c.variableName}`;
            return `    <${targetElement}>\n      <xsl:variable name="${escapeXml(c.variableName)}" select="${escapeXml(c.variableExpression)}"/>\n      <value><xsl:value-of select="${escapeXml(expr)}"/></value>\n    </${targetElement}>`;
        }

        if (t === "logger") {
            const expr = c.hardcodedValue ? `'${escapeXml(c.hardcodedValue)}'` : (c.expression || c.sourcePath);
            return `    <${targetElement}><xsl:value-of select="${escapeXml(expr)}"/></${targetElement}>`;
        }

        if (t === "substring") {
            const expr = c.expression || `substring(${c.sourcePath}, 1, 10)`;
            return `    <${targetElement}><xsl:value-of select="${escapeXml(expr)}"/></${targetElement}>`;
        }

        const expr = c.expression || c.sourcePath;
        return `    <${targetElement}><xsl:value-of select="${escapeXml(expr)}"/></${targetElement}>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="xml" indent="yes"/>
  <xsl:template match="/">
${body}
  </xsl:template>
</xsl:stylesheet>`;
}

function detectTransformationType(expression: string): MapperTransformationType {
    const value = expression.trim();
    if (!value) {
        return "direct";
    }
    if (value.includes("concat(")) {
        return "concat";
    }
    if (value.includes("substring(")) {
        return "substring";
    }
    if (value.includes("if (") && value.includes(" then ")) {
        return "conditional";
    }
    if (value.startsWith("$") && value.includes("/") === false) {
        return "variable";
    }
    const functionPatterns = ["substring(", "normalize-space(", "contains(", "starts-with(", "tokenize(", "camel:", "fn:"];
    if (functionPatterns.some((p) => value.includes(p))) {
        return "function";
    }
    return "direct";
}

function parseMapperConfig(note?: string): MapperConfig {
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
}

function serializeMapperConfig(note: string | undefined, config: MapperConfig): string | undefined {
    const baseNote = (note ?? "")
        .split(MAPPER_NOTE_PREFIX)[0]
        .trim();

    const hasConfig = Boolean(config.sourcePath || config.targetPath || config.xslt);
    if (!hasConfig) {
        return baseNote || undefined;
    }

    const serializedConfig = `${MAPPER_NOTE_PREFIX}${JSON.stringify(config)}`;
    return [baseNote, serializedConfig].filter(Boolean).join("\n");
}

function isKameletMapperUri(uri?: string): boolean {
    if (!uri) {
        return false;
    }
    const lower = uri.toLowerCase();
    return lower.startsWith("kamelet:") && /(mapper|transform-xml|xslt)/.test(lower);
}

function getMapperXslt(step?: CamelElement): string {
    const noteConfig = parseMapperConfig((step as any)?.note);
    if (noteConfig.xslt) {
        return noteConfig.xslt;
    }

    const expression = (step as any)?.expression as ExpressionDefinition | undefined;
    const language = expression?.language as LanguageExpression | undefined;
    if (language?.language === "xslt") {
        return language.expression ?? "";
    }
    return "";
}

export function isMapperStep(step: any): boolean {
    if (!step) {
        return false;
    }

    if (step.dslName === "TransformDefinition") {
        return true;
    }

    if ((step.dslName === "ToDefinition" || step.dslName === "ToDynamicDefinition") && isKameletMapperUri((step as ToDefinition)?.uri)) {
        return true;
    }

    const expressionLanguage = step?.expression?.language?.language;
    return expressionLanguage === "xslt" || Object.keys(parseMapperConfig(step.note)).length > 0;
}

export function MapperPanel() {
    const mapperSurfaceRef = useRef<HTMLDivElement>(null);
    const [dragSourceNode, setDragSourceNode] = useState<MapperNode | undefined>(undefined);
    const [connectionLines, setConnectionLines] = useState<ConnectionLine[]>([]);

    const [selectedStep, setSelectedStep, tab] = useDesignerStore((s) => [s.selectedStep, s.setSelectedStep, s.tab], shallow);
    const [integration, setIntegration] = useIntegrationStore((s) => [s.integration, s.setIntegration], shallow);
    const [workspaceFiles, fileContents] = useWorkspaceStore((s: any) => [s.files, s.fileContents], shallow);

    const [sourcePath, setSourcePath] = useState("");
    const [targetPath, setTargetPath] = useState("");
    const [xsltText, setXsltText] = useState("");
    const [saveError, setSaveError] = useState<string>();
    const [infoMessage, setInfoMessage] = useState<string>();
    const [sourceNodes, setSourceNodes] = useState<MapperNode[]>([]);
    const [targetNodes, setTargetNodes] = useState<MapperNode[]>([]);
    const [connections, setConnections] = useState<MapperConnection[]>([]);
    const [viewMode, setViewMode] = useState<MapperViewMode>("tree");
    const [editingConnectionId, setEditingConnectionId] = useState<string | undefined>(undefined);
    const [selectedSourceNode, setSelectedSourceNode] = useState<MapperNode | undefined>(undefined);
    const [selectedTargetNode, setSelectedTargetNode] = useState<MapperNode | undefined>(undefined);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

    const mapperStep = useMemo(() => isMapperStep(selectedStep) ? selectedStep as CamelElement : undefined, [selectedStep]);
    const mapperConfig = useMemo(() => parseMapperConfig((mapperStep as any)?.note), [mapperStep]);
    const currentXslt = useMemo(() => getMapperXslt(mapperStep), [mapperStep]);
    const editingConnection = useMemo(() => connections.find(c => c.id === editingConnectionId), [connections, editingConnectionId]);

    useEffect(() => {
        setSourcePath(mapperConfig.sourcePath ?? "");
        setTargetPath(mapperConfig.targetPath ?? "");
        setXsltText(currentXslt ?? "");
        setSaveError(undefined);
        setInfoMessage(undefined);
    }, [currentXslt, mapperStep?.uuid, mapperConfig.sourcePath, mapperConfig.targetPath]);

    const workspaceXsdFiles = useMemo(() => {
        return (workspaceFiles || [])
            .filter((f: string) => /\.(xsd|xml|wsdl|xsl|xslt)$/i.test(f))
            .sort((a: string, b: string) => a.localeCompare(b));
    }, [workspaceFiles]);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (event.data?.command === "mapperWorkspaceFileSelected") {
                if (event.data.error) {
                    setSaveError(event.data.error);
                    return;
                }

                const role = event.data.role as "source" | "target" | "xslt" | undefined;
                const relativePath = event.data.relativePath as string | undefined;
                const content = event.data.content as string | undefined;

                if (relativePath && role === "source") {
                    setSourcePath(relativePath);
                } else if (relativePath && role === "target") {
                    setTargetPath(relativePath);
                } else if (role === "xslt" && content) {
                    setXsltText(content);
                    setInfoMessage(relativePath ? `Loaded XSLT from ${relativePath}` : "Loaded XSLT from workspace");
                }
            } else if (event.data?.command === "xsltUpdated") {
                if (event.data.content) {
                    setXsltText(event.data.content);
                    setInfoMessage("XSLT updated from editor");
                }
            }
        };

        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    useEffect(() => {
        if (sourcePath.trim()) {
            requestWorkspaceFile(sourcePath.trim());
        }
    }, [sourcePath]);

    useEffect(() => {
        if (targetPath.trim()) {
            requestWorkspaceFile(targetPath.trim());
        }
    }, [targetPath]);

    const sourceXsd = sourcePath ? fileContents[sourcePath.replace(/\\/g, "/")] : undefined;
    const targetXsd = targetPath ? fileContents[targetPath.replace(/\\/g, "/")] : undefined;

    useEffect(() => {
        if (!sourceXsd) {
            setSourceNodes([]);
            return;
        }
        try {
            setSourceNodes(parseXsdNodes(sourceXsd, "SourceSchema"));
            setSaveError(undefined);
        } catch (e: any) {
            setSaveError(`Source XSD parse error: ${e?.message ?? String(e)}`);
        }
    }, [sourceXsd]);

    useEffect(() => {
        if (!targetXsd) {
            setTargetNodes([]);
            return;
        }
        try {
            setTargetNodes(parseXsdNodes(targetXsd, "TargetSchema"));
            setSaveError(undefined);
        } catch (e: any) {
            setSaveError(`Target XSD parse error: ${e?.message ?? String(e)}`);
        }
    }, [targetXsd]);

    function requestWorkspaceFilePick(role: "source" | "target" | "xslt") {
        const extensions = role === "xslt"
            ? [".xslt", ".xsl", ".xml"]
            : [".xsd", ".xml", ".wsdl"];

        vscode?.postMessage({
            command: "chooseMapperWorkspaceFile",
            role,
            extensions,
        });
    }

    function handleOpenInEditor() {
        if (!xsltText.trim()) {
            setSaveError("XSLT is empty. Generate or paste XSLT first.");
            return;
        }
        vscode?.postMessage({ command: "openXSLTPreview", content: xsltText });
    }

    function getGeneratedXslt(): string {
        if (!xsltText.trim() && connections.length > 0) {
            return buildXsltFromMappings(connections);
        }
        const value = xsltText.trim();
        if (!value) {
            throw new Error("XSLT is empty. Generate or paste XSLT first.");
        }
        return value;
    }

    function importMappingsFromXslt() {
        const value = xsltText.trim();
        if (!value) {
            setSaveError("XSLT is empty.");
            return;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(value, "application/xml");
            const parseError = doc.querySelector("parsererror");
            if (parseError) {
                throw new Error("Invalid XSLT format.");
            }

            const mappings: MapperConnection[] = [];
            const nodes = doc.querySelectorAll("xsl\\:value-of, value-of");
            nodes.forEach((valueNode, index) => {
                const sourcePath = valueNode.getAttribute("select") || "";
                const parent = valueNode.parentElement;
                const parentName = parent?.localName;
                if (!sourcePath || !parentName || parentName === "if" || parentName === "choose" || parentName === "when" || parentName === "otherwise") {
                    return;
                }

                const whenNode = valueNode.closest("xsl\\:when, when") as Element | null;
                const condition = whenNode?.getAttribute("test") || undefined;
                mappings.push({
                    id: `import-${index}-${Date.now()}`,
                    sourcePath,
                    targetPath: parentName,
                    transformationType: condition ? "conditional" : detectTransformationType(sourcePath),
                    expression: sourcePath,
                    condition,
                    thenExpression: condition ? sourcePath : undefined,
                });
            });

            if (mappings.length === 0) {
                setSaveError("No simple mappings found in XSLT.");
                return;
            }

            setConnections(mappings);
            setInfoMessage(`Imported ${mappings.length} mapping(s) from XSLT.`);
            setSaveError(undefined);
        } catch (e: any) {
            setSaveError(`XSLT import error: ${e?.message ?? String(e)}`);
        }
    }

    function updateConnectionTransformation(id: string, updates: Partial<MapperConnection>) {
        setConnections((prev) => prev.map((conn) => conn.id === id ? { ...conn, ...updates } : conn));
    }

    function saveMapperProject() {
        const project: MapperProjectState = {
            version: "1",
            sourcePath: sourcePath.trim() || undefined,
            targetPath: targetPath.trim() || undefined,
            xsltText: xsltText || undefined,
            connections,
        };
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "mapper-project.json";
        a.click();
        URL.revokeObjectURL(url);
        setInfoMessage("Mapper project saved.");
    }

    function loadMapperProject() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
                return;
            }
            try {
                const content = await file.text();
                const project = JSON.parse(content) as MapperProjectState;
                setSourcePath(project.sourcePath ?? "");
                setTargetPath(project.targetPath ?? "");
                setXsltText(project.xsltText ?? "");
                setConnections(Array.isArray(project.connections) ? project.connections : []);
                setInfoMessage("Mapper project loaded.");
                setSaveError(undefined);
            } catch (error: any) {
                setSaveError(`Failed to load mapper project: ${error?.message ?? String(error)}`);
            }
        };
        input.click();
    }

    function addConnection(source: MapperNode, target: MapperNode) {
        const id = `map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setConnections((prev) => {
            const exists = prev.some((c) => c.sourcePath === source.path && c.targetPath === target.path);
            if (exists) {
                return prev;
            }
            return [...prev, { id, sourcePath: source.path, targetPath: target.path }];
        });
        setInfoMessage(`Mapped ${source.path} -> ${target.path}`);
    }

    function refreshConnectionLines() {
        if (!mapperSurfaceRef.current) {
            setConnectionLines([]);
            return;
        }

        const containerRect = mapperSurfaceRef.current.getBoundingClientRect();
        const lines: ConnectionLine[] = [];

        connections.forEach((connection) => {
            const colorIndex = connections.findIndex((c) => c.id === connection.id);
            const sourceEl = mapperSurfaceRef.current?.querySelector(`[data-mapper-side="source"][data-mapper-path="${CSS.escape(connection.sourcePath)}"]`) as HTMLElement | null;
            const targetEl = mapperSurfaceRef.current?.querySelector(`[data-mapper-side="target"][data-mapper-path="${CSS.escape(connection.targetPath)}"]`) as HTMLElement | null;
            if (!sourceEl || !targetEl) {
                return;
            }

            const sourceRect = sourceEl.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();

            lines.push({
                id: connection.id,
                x1: sourceRect.right - containerRect.left,
                y1: sourceRect.top + sourceRect.height / 2 - containerRect.top,
                x2: targetRect.left - containerRect.left,
                y2: targetRect.top + targetRect.height / 2 - containerRect.top,
                color: MAPPER_COLORS[colorIndex % MAPPER_COLORS.length],
            });
        });

        setConnectionLines(lines);
    }

    useEffect(() => {
        refreshConnectionLines();
        const onResize = () => refreshConnectionLines();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [connections, sourceNodes, targetNodes, expandedNodes]);

    function renderNode(node: MapperNode, side: "source" | "target", level: number = 0) {
        const isExpanded = expandedNodes.has(node.id);
        const hasChildren = node.children.length > 0;
        const isSelected = side === "source"
            ? selectedSourceNode?.id === node.id
            : selectedTargetNode?.id === node.id;

        return (
            <div key={node.id}>
                <div
                    style={{
                        paddingLeft: `${level * 14 + 6}px`,
                        paddingTop: 4,
                        paddingBottom: 4,
                        borderRadius: 4,
                        background: isSelected ? "var(--pf-t--global--background--color--secondary--default)" : "transparent",
                        cursor: "pointer",
                    }}
                    draggable={side === "source"}
                    data-mapper-side={side}
                    data-mapper-path={node.path}
                    onDragStart={(e) => {
                        if (side === "source") {
                            setSelectedSourceNode(node);
                            setDragSourceNode(node);
                            e.dataTransfer.setData("text/plain", node.path);
                            e.dataTransfer.effectAllowed = "copy";
                        }
                    }}
                    onDragOver={(e) => {
                        if (side === "target") {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                        }
                    }}
                    onDrop={(e) => {
                        if (side === "target") {
                            e.preventDefault();
                            const sourcePath = e.dataTransfer.getData("text/plain");
                            const sourceNode = dragSourceNode || selectedSourceNode;
                            if (sourceNode && (!sourcePath || sourceNode.path === sourcePath)) {
                                addConnection(sourceNode, node);
                            }
                        }
                    }}
                    onClick={() => {
                        if (side === "source") {
                            setSelectedSourceNode(node);
                        } else {
                            setSelectedTargetNode(node);
                        }
                        if (hasChildren) {
                            setExpandedNodes((prev) => {
                                const next = new Set(prev);
                                if (next.has(node.id)) {
                                    next.delete(node.id);
                                } else {
                                    next.add(node.id);
                                }
                                return next;
                            });
                        }
                    }}
                >
                    {hasChildren ? (isExpanded ? "▾ " : "▸ ") : "• "}
                    <span>{node.name}</span>
                    <span style={{ opacity: 0.7 }}> : {node.type}</span>
                </div>
                {hasChildren && isExpanded && node.children.map((child) => renderNode(child, side, level + 1))}
            </div>
        );
    }

    function updateSelectedStep(updatedStep: CamelElement) {
        const clone = CamelUtil.cloneIntegration(integration);
        let updatedIntegration = clone;

        if (tab === "routes") {
            updatedIntegration = CamelDefinitionApiExt.updateIntegrationRouteElement(clone, updatedStep);
        } else if (tab === "rest") {
            updatedIntegration = CamelDefinitionApiExt.updateIntegrationRestElement(clone, updatedStep);
        } else if (tab === "beans") {
            updatedIntegration = CamelDefinitionApiExt.updateIntegrationBeanElement(clone, updatedStep);
        }

        setSelectedStep(updatedStep);
        setIntegration(updatedIntegration, true);
    }

    async function handleSaveToActivity() {
        if (!mapperStep) {
            return;
        }

        try {
            const generatedXslt = getGeneratedXslt();
            const clone = CamelUtil.cloneStep(mapperStep) as any;
            const config: MapperConfig = {
                sourcePath: sourcePath.trim() || undefined,
                targetPath: targetPath.trim() || undefined,
            };

            if (clone.dslName === "TransformDefinition") {
                clone.expression = new ExpressionDefinition({
                    language: new LanguageExpression({
                        language: "xslt",
                        expression: generatedXslt,
                    }),
                });
            } else {
                const parameters = { ...(clone.parameters ?? {}) };
                const knownXsltKeys = ["xslt", "xsltTemplate", "template", "stylesheet"];
                const existingKey = knownXsltKeys.find((k) => Object.prototype.hasOwnProperty.call(parameters, k));
                parameters[existingKey ?? "xslt"] = generatedXslt;
                clone.parameters = parameters;
                config.xslt = generatedXslt;
            }

            clone.note = serializeMapperConfig(clone.note, config);
            updateSelectedStep(clone);
            setSaveError(undefined);
            setInfoMessage("Mapper activity updated.");
        } catch (error: any) {
            setSaveError(error?.message ?? String(error));
        }
    }

    function chooseSourceFromWorkspace(pathValue: string) {
        setSourcePath(pathValue);
    }

    function chooseTargetFromWorkspace(pathValue: string) {
        setTargetPath(pathValue);
    }

    if (!mapperStep) {
        return (
            <Alert isInline variant="info" title="Mapper is available for Transform and Mapper Activity steps.">
                Select a Transform step or Mapper Activity to load or edit XSLT mapping in this panel.
            </Alert>
        );
    }

    return (
        <div className="properties mapper-shadcn">
            <Form isWidthLimited className="mapper-shell">
                <div className="mapper-card mapper-header">
                    <Title headingLevel="h2" size="md">Mapper</Title>
                    <div className="mapper-subtitle">Native visual mapper inspired by the original XSLT generator UX.</div>
                </div>

                <div className="mapper-grid2">
                    <div className="mapper-card">
                        <FormGroup label="Source XSD path" fieldId="mapper-source-path">
                            <input id="mapper-source-path" className="mapper-input" value={sourcePath} onChange={(e) => setSourcePath(e.target.value)} />
                            <div className="mapper-row mapper-mt8">
                                <button type="button" className="mapper-btn" onClick={() => requestWorkspaceFilePick("source")}>Pick Source From Workspace</button>
                            </div>
                            {workspaceXsdFiles.length > 0 && (
                                <select
                                    className="mapper-select mapper-mt8"
                                    value={workspaceXsdFiles.includes(sourcePath) ? sourcePath : ""}
                                    onChange={(e) => chooseSourceFromWorkspace(e.target.value)}
                                >
                                    <option value="">Choose source path from workspace...</option>
                                    {workspaceXsdFiles.map((filePath: string) => (
                                        <option key={`src-${filePath}`} value={filePath}>{filePath}</option>
                                    ))}
                                </select>
                            )}
                        </FormGroup>
                    </div>

                    <div className="mapper-card">
                        <FormGroup label="Target XSD path" fieldId="mapper-target-path">
                            <input id="mapper-target-path" className="mapper-input" value={targetPath} onChange={(e) => setTargetPath(e.target.value)} />
                            <div className="mapper-row mapper-mt8">
                                <button type="button" className="mapper-btn" onClick={() => requestWorkspaceFilePick("target")}>Pick Target From Workspace</button>
                            </div>
                            {workspaceXsdFiles.length > 0 && (
                                <select
                                    className="mapper-select mapper-mt8"
                                    value={workspaceXsdFiles.includes(targetPath) ? targetPath : ""}
                                    onChange={(e) => chooseTargetFromWorkspace(e.target.value)}
                                >
                                    <option value="">Choose target path from workspace...</option>
                                    {workspaceXsdFiles.map((filePath: string) => (
                                        <option key={`tgt-${filePath}`} value={filePath}>{filePath}</option>
                                    ))}
                                </select>
                            )}
                        </FormGroup>
                    </div>
                </div>

                <FormGroup label="XSLT" fieldId="mapper-xslt-editor">
                    <textarea
                        id="mapper-xslt-editor"
                        className="mapper-textarea"
                        value={xsltText}
                        onChange={(e) => setXsltText(e.target.value)}
                        rows={20}
                    />
                    <div className="mapper-row mapper-wrap mapper-mt8">
                        <button type="button" className="mapper-btn" onClick={() => requestWorkspaceFilePick("xslt")}>Load XSLT From Workspace</button>
                        <button type="button" className="mapper-btn" onClick={handleOpenInEditor}>Open In VS Code Editor</button>
                        <button type="button" className="mapper-btn" onClick={() => setXsltText(buildXsltFromMappings(connections))}>Generate XSLT From Mappings</button>
                        <button type="button" className="mapper-btn" onClick={importMappingsFromXslt}>Import Mappings From XSLT</button>
                        <button type="button" className="mapper-btn" onClick={saveMapperProject}>Save Mapper Project</button>
                        <button type="button" className="mapper-btn" onClick={loadMapperProject}>Load Mapper Project</button>
                    </div>
                </FormGroup>

                <FormGroup label="Visual Mapper" fieldId="mapper-visual">
                    <div className="mapper-row mapper-mb8">
                        <button type="button" className={`mapper-btn ${viewMode === "tree" ? "mapper-btn-primary" : ""}`} onClick={() => setViewMode("tree")}>Tree View</button>
                        <button type="button" className={`mapper-btn ${viewMode === "flow" ? "mapper-btn-primary" : ""}`} onClick={() => setViewMode("flow")}>Flow Diagram</button>
                    </div>
                    {viewMode === "tree" && (
                    <div ref={mapperSurfaceRef} style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <svg
                            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}
                        >
                            {connectionLines.map((line) => (
                                <path
                                    key={line.id}
                                    d={`M ${line.x1} ${line.y1} C ${line.x1 + 60} ${line.y1}, ${line.x2 - 60} ${line.y2}, ${line.x2} ${line.y2}`}
                                    stroke={line.color}
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    fill="none"
                                />
                            ))}
                            {connectionLines.map((line) => (
                                <circle key={`${line.id}-target`} cx={line.x2} cy={line.y2} r="3" fill={line.color} />
                            ))}
                        </svg>
                        <div style={{ border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 10, padding: 8, maxHeight: 320, overflow: "auto", background: "var(--pf-t--global--background--color--primary--default)" }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>Source Schema</div>
                            {sourceNodes.length === 0 ? <div style={{ opacity: 0.7 }}>Load source XSD to see nodes.</div> : sourceNodes.map((n) => renderNode(n, "source"))}
                        </div>
                        <div style={{ border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 10, padding: 8, maxHeight: 320, overflow: "auto", background: "var(--pf-t--global--background--color--primary--default)" }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>Target Schema</div>
                            {targetNodes.length === 0 ? <div style={{ opacity: 0.7 }}>Load target XSD to see nodes.</div> : targetNodes.map((n) => renderNode(n, "target"))}
                        </div>
                    </div>
                    )}

                    {viewMode === "flow" && (
                        <div style={{ border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 6, padding: 10, maxHeight: 360, overflow: "auto" }}>
                            {connections.length === 0 && <div style={{ opacity: 0.7 }}>No mappings to visualize.</div>}
                            {connections.map((c, index) => (
                                <div key={`flow-${c.id}`} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 8, alignItems: "center", marginBottom: 10, padding: 8, border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 6 }}>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.sourcePath}>{c.sourcePath}</div>
                                    <div>→</div>
                                    <div style={{ fontWeight: 600 }}>{c.transformationType || "direct"}</div>
                                    <div>→</div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.targetPath}>{c.targetPath}</div>
                                    {index < connections.length - 1 && <div style={{ gridColumn: "1 / -1", opacity: 0.5 }}>↓</div>}
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="mapper-row mapper-mt8">
                        <button
                            type="button"
                            className="mapper-btn"
                            onClick={() => {
                                if (selectedSourceNode && selectedTargetNode) {
                                    addConnection(selectedSourceNode, selectedTargetNode);
                                }
                            }}
                            disabled={!selectedSourceNode || !selectedTargetNode}
                        >
                            Create Mapping From Selected
                        </button>
                        <button type="button" className="mapper-btn" onClick={() => setConnections([])} disabled={connections.length === 0}>Clear Mappings</button>
                    </div>

                    <div style={{ marginTop: 10, border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 6, padding: 8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>Mappings ({connections.length})</div>
                        {connections.length === 0 && <div style={{ opacity: 0.7 }}>No mappings yet. Drag source node onto target node.</div>}
                        {connections.map((c) => (
                            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                                <div
                                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", fontWeight: editingConnectionId === c.id ? 600 : 400 }}
                                    onClick={() => setEditingConnectionId(c.id)}
                                    title={`${c.sourcePath} -> ${c.targetPath}`}
                                >
                                    [{c.transformationType || "direct"}] {c.sourcePath} {"->"} {c.targetPath}
                                </div>
                                <button type="button" className="mapper-btn" onClick={() => setConnections((prev) => prev.filter((x) => x.id !== c.id))}>Remove</button>
                            </div>
                        ))}
                    </div>

                    {editingConnection && (
                        <div style={{ marginTop: 10, border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 6, padding: 8 }}>
                            <div style={{ fontWeight: 600, marginBottom: 8 }}>Edit Mapping Transformation</div>
                            <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 8, alignItems: "center" }}>
                                <div>Transformation Type</div>
                                <select
                                    value={editingConnection.transformationType || "direct"}
                                    onChange={(e) => updateConnectionTransformation(editingConnection.id, { transformationType: e.target.value as MapperTransformationType })}
                                    style={{ width: "100%", background: "var(--pf-t--global--background--color--primary--default)", color: "var(--pf-t--global--text--color--regular)", border: "1px solid var(--pf-t--global--border--color--default)", borderRadius: 4, padding: 6 }}
                                >
                                    <option value="direct">Direct</option>
                                    <option value="function">Function</option>
                                    <option value="concat">Concat</option>
                                    <option value="conditional">Conditional</option>
                                    <option value="variable">Variable</option>
                                    <option value="inline-variable">Inline Variable</option>
                                    <option value="nested-variable">Nested Variable</option>
                                    <option value="logger">Logger</option>
                                    <option value="substring">Substring</option>
                                </select>

                                <div>Expression</div>
                                <input className="mapper-input" value={editingConnection.expression ?? editingConnection.sourcePath} onChange={(e) => updateConnectionTransformation(editingConnection.id, { expression: e.target.value })} />

                                {(editingConnection.transformationType || "direct") === "conditional" && (
                                    <>
                                        <div>Condition</div>
                                        <input className="mapper-input" value={editingConnection.condition ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { condition: e.target.value })} />
                                        <div>Then Expression</div>
                                        <input className="mapper-input" value={editingConnection.thenExpression ?? editingConnection.sourcePath} onChange={(e) => updateConnectionTransformation(editingConnection.id, { thenExpression: e.target.value })} />
                                        <div>Else Expression</div>
                                        <input className="mapper-input" value={editingConnection.elseExpression ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { elseExpression: e.target.value })} />
                                    </>
                                )}

                                {(editingConnection.transformationType || "direct") === "variable" && (
                                    <>
                                        <div>Variable Name</div>
                                        <input className="mapper-input" value={editingConnection.variableName ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableName: e.target.value })} />
                                        <div>Variable Expression</div>
                                        <input className="mapper-input" value={editingConnection.variableExpression ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableExpression: e.target.value })} />
                                    </>
                                )}

                                {(editingConnection.transformationType || "direct") === "inline-variable" && (
                                    <>
                                        <div>Variable Name</div>
                                        <input className="mapper-input" value={editingConnection.variableName ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableName: e.target.value })} />
                                        <div>Variable Expression</div>
                                        <input className="mapper-input" value={editingConnection.variableExpression ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableExpression: e.target.value })} />
                                    </>
                                )}

                                {(editingConnection.transformationType || "direct") === "nested-variable" && (
                                    <>
                                        <div>Variable Name</div>
                                        <input className="mapper-input" value={editingConnection.variableName ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableName: e.target.value })} />
                                        <div>Variable Expression</div>
                                        <input className="mapper-input" value={editingConnection.variableExpression ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { variableExpression: e.target.value })} />
                                    </>
                                )}

                                {(editingConnection.transformationType || "direct") === "logger" && (
                                    <>
                                        <div>Hardcoded Value (Optional)</div>
                                        <input className="mapper-input" value={editingConnection.hardcodedValue ?? ""} onChange={(e) => updateConnectionTransformation(editingConnection.id, { hardcodedValue: e.target.value })} />
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </FormGroup>

                {workspaceFiles.length > 0 && (
                    <Alert
                        isInline
                        variant="info"
                        title="Native mapper mode (no iframe). Use workspace picks and edit XSLT directly in this panel."
                    />
                )}
                {infoMessage && <Alert isInline variant="success" title={infoMessage} />}
                {saveError && <Alert isInline variant="danger" title={saveError} />}
                <div className="mapper-row mapper-mt12 mapper-mb12">
                    <button type="button" className="mapper-btn mapper-btn-primary" onClick={handleSaveToActivity}>Save To Activity</button>
                </div>
            </Form>
        </div>
    );
}