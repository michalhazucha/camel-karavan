import { ButtonVariant, MappingTransformationType, type IMapperProject, type IMappingConnection, type IMappingTransformation, type IXSDNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { XSDParser, XSLTGenerator, XSLTParser } from "@karavan/mapper-core";
import { Highlight, themes } from "prism-react-renderer";
import { useEffect, useRef, useState } from "react";
import { LuFileCode, LuRefreshCcw, LuSave, LuSettings2, LuTrash2, LuUpload, LuWorkflow } from "react-icons/lu";
import { VscVscodeInsiders } from "react-icons/vsc";
import { ConnectionLines } from "./components/connection-lines";
import { SchemaTree } from "./components/schema-tree";
import SheetEditor from "./components/SheetEditor";
import { TransformationDialog } from "./components/transformation-dialog";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import type { KaravanMapperContext, KaravanMapperHost, KaravanSourceVariable } from "./karavan-host";
import { MappedNodeIDs, ViewMode } from "./lib/constants";
import { connectionColors } from "./lib/variables";
import {
    applyMapperDarkClass,
    isThemeMessage,
    isVsCodeDarkBody,
    resolveVsCodeThemeDark,
    watchVsCodeBodyTheme,
} from "./lib/vscode-theme";
import { getVsCodeApi } from "./vscode-api";

declare global {
  interface Window {
    __KARAVAN_MAPPER_MODE?: "full" | "selection-panel";
    __KARAVAN_MAPPER_ROLE?: "primary" | "secondary";
  }
}

interface AppProps {
  host?: KaravanMapperHost;
}

const schemaPathBaseName = (p?: string): string => {
  if (!p) {
    return "";
  }
  const normalized = p.replace(/\\/g, "/").replace(/^file:/i, "");
  return normalized.split("/").pop() ?? normalized;
};

const pathsLooselyMatch = (a?: string, b?: string): boolean => {
  if (!a || !b) {
    return false;
  }
  const na = a.replace(/\\/g, "/");
  const nb = b.replace(/\\/g, "/");
  if (na === nb || na.endsWith(nb) || nb.endsWith(na)) {
    return true;
  }
  return schemaPathBaseName(na) === schemaPathBaseName(nb) && schemaPathBaseName(na).length > 0;
};

const resolveSourceVariableEntry = (
  ctx: KaravanMapperContext | null | undefined,
  relativePath?: string,
): KaravanSourceVariable | undefined => {
  const variables = ctx?.sourceVariables ?? [];
  if (variables.length === 0) {
    return undefined;
  }
  for (const entry of variables) {
    if (entry.schemaPath && pathsLooselyMatch(entry.schemaPath, relativePath ?? ctx?.sourcePath)) {
      return entry;
    }
  }
  const withSchema = [...variables].reverse().find((entry) => entry.schemaPath?.trim());
  return withSchema ?? variables[variables.length - 1];
};

const sourceVariableTreePath = (entry: KaravanSourceVariable): string => {
  const binding = entry.bindingName?.trim() || entry.variableReceive.replace(/^\$/, "");
  return binding.startsWith("$") ? binding : `$${binding}`;
};

const mergeSourceRoots = (existing: IXSDNode[] | undefined, newRoots: IXSDNode[]): IXSDNode[] => {
  const merged = [...(existing ?? [])];
  for (const root of newRoots) {
    const index = merged.findIndex((node) => node.path === root.path);
    if (index >= 0) {
      merged[index] = root;
    } else {
      merged.push(root);
    }
  }
  return merged;
};

const buildVirtualTreeFromMappings = (
  varPath: string,
  mappings: Array<{ sourcePath: string }>,
): IXSDNode | null => {
  const relevant = mappings.filter(
    (mapping) =>
      mapping.sourcePath === varPath
      || mapping.sourcePath.startsWith(`${varPath}/`),
  );
  if (relevant.length === 0) {
    return null;
  }

  const root: IXSDNode = {
    id: `var-${varPath.replace(/^\$/, "")}`,
    name: varPath,
    type: "variable",
    path: varPath,
    children: [],
  };

  const ensureChild = (parent: IXSDNode, segment: string, fullPath: string): IXSDNode => {
    const children = parent.children ?? [];
    let child = children.find((node) => node.name === segment);
    if (!child) {
      child = {
        id: `virt-${fullPath.replace(/[^\w-]+/g, "_")}`,
        name: segment,
        type: "element",
        path: fullPath,
        children: [],
      };
      children.push(child);
      parent.children = children;
    }
    return child;
  };

  for (const mapping of relevant) {
    const afterVar = mapping.sourcePath.replace(/^\$[\w-]+\/?/, "");
    const segments = afterVar
      .split("/")
      .map((segment) => segment.replace(/^\w+:/, ""))
      .filter(Boolean);
    let parent = root;
    let cumulative = varPath;
    for (const segment of segments) {
      cumulative = `${cumulative}/${segment}`;
      parent = ensureChild(parent, segment, cumulative);
    }
  }

  return root;
};

const augmentSourceSchemaFromMappings = (
  sourceSchema: IMapperProject["sourceSchema"],
  mappings: Array<{ sourcePath: string }>,
  ctx: KaravanMapperContext | null | undefined,
): IMapperProject["sourceSchema"] => {
  if (!sourceSchema) {
    return sourceSchema;
  }
  const existingPaths = new Set((sourceSchema.nodes ?? []).map((node) => node.path));
  const extraRoots: IXSDNode[] = [];
  for (const entry of ctx?.sourceVariables ?? []) {
    const varPath = sourceVariableTreePath(entry);
    if (existingPaths.has(varPath)) {
      continue;
    }
    const virtual = buildVirtualTreeFromMappings(varPath, mappings);
    if (virtual) {
      extraRoots.push(virtual);
      existingPaths.add(varPath);
    }
  }
  if (extraRoots.length === 0) {
    return sourceSchema;
  }
  return {
    ...sourceSchema,
    nodes: mergeSourceRoots(sourceSchema.nodes, extraRoots),
  };
};

const rebaseNodePaths = (node: IXSDNode, prefix: string): IXSDNode => ({
  ...node,
  path: node.path ? `${prefix}/${node.path}` : prefix,
  children: node.children?.map((child) => rebaseNodePaths(child, prefix)),
});

const wrapNodesWithVariable = (nodes: IXSDNode[], variableReceive: string): IXSDNode[] => {
  const varPath = variableReceive.startsWith("$") ? variableReceive : `$${variableReceive}`;
  const varKey = varPath.replace(/^\$/, "");
  return [
    {
      id: `var-${varKey}`,
      name: varPath,
      type: "variable",
      path: varPath,
      children: nodes.map((node) => rebaseNodePaths(node, varPath)),
    },
  ];
};

function App({ host }: AppProps) {
  const isSelectionPanelMode = window.__KARAVAN_MAPPER_MODE === "selection-panel";
  const isSecondaryPanel = window.__KARAVAN_MAPPER_ROLE === "secondary";
  const isKaravanEmbedded = Boolean(host) && !isSecondaryPanel;
  const vscode =
    !host || isSecondaryPanel
      ? getVsCodeApi()
      : { postMessage: (_message: unknown) => undefined };
  const xsltParser = new XSLTParser();
  const parser = new XSDParser()
  const generator = new XSLTGenerator()


  const leftSchemaListRef = useRef(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const [project, setProject] = useState<IMapperProject>({
    name: "New Mapping Project",
    sourceSchema: null,
    targetSchema: null,
    connections: [],
  })
  const [treeExpanded, setTreeExpanded] = useState<boolean>(false)
  const [selectedSource, setSelectedSource] = useState<IXSDNode | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<IXSDNode | null>(null)
  const [draggedSource, setDraggedSource] = useState<IXSDNode | null>(null)
  const [generatedXSLT, setGeneratedXSLT] = useState<string>("")
  const [showXSLT, setShowXSLT] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Tree)
  const [transformationDialogOpen, setTransformationDialogOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState<IMappingConnection | null>(null)
  const [highlightedConnectionId, setHighlightedConnectionId] = useState<string | null>(null)
  const [themeDark, setThemeDark] = useState<boolean>(() => isVsCodeDarkBody())
  const [xsltMappings, setXsltMappings] = useState<Array<{
    sourcePath: string
    targetPath: string
    expression?: string
    isConditional?: boolean
    condition?: string
  }>
  >([])
  const [originalLoadedXSLT, setOriginalLoadedXSLT] = useState<string | null>(null)
  const [activeSchemaPaths, setActiveSchemaPaths] = useState<{ source?: string; target?: string }>({})
  const [allowLoadXsd, setAllowLoadXsd] = useState(!host)
  const [activityName, setActivityName] = useState("")
  /** Selection paths mirrored from the primary mapper (bottom panel has no XSD trees). */
  const [syncedSelectionPaths, setSyncedSelectionPaths] = useState<{
    source?: string;
    target?: string;
  }>({})
  const pendingXsltRef = useRef<string | null>(null)
  const schemasAwaitingXsltRef = useRef(false)
  const lastXsltContentRef = useRef<string | null>(null)

  const PLACEHOLDER_SOURCE = "SourceSchema"
  const PLACEHOLDER_TARGET = "TargetSchema"

  const isRealSchema = (
    schema: IMapperProject["sourceSchema"],
    placeholderName: string,
  ): boolean =>
    Boolean(
      schema?.nodes?.length &&
      schema.nodes[0].name !== placeholderName,
    )

  const [sheetOpen, setSheetOpen] = useState(false)

  const findNodeByPath = (nodes: IXSDNode[] | undefined, nodePath?: string): IXSDNode | null => {
    if (!nodes || !nodePath) {
      return null;
    }
    for (const node of nodes) {
      if (node.path === nodePath) {
        return node;
      }
      const nested = findNodeByPath(node.children, nodePath);
      if (nested) {
        return nested;
      }
    }
    return null;
  };

  const publishSelectionState = () => {
    if (isSecondaryPanel) {
      return;
    }
    const serializedConnections = project.connections.map((connection) => ({
      id: connection.id,
      sourcePath: connection.sourcePath,
      targetPath: connection.targetPath,
      sourceId: connection.sourceId,
      targetId: connection.targetId,
      type: connection.type,
      transformation: connection.transformation,
    }));
    const payload = {
      selectedSourcePath: selectedSource?.path,
      selectedTargetPath: selectedTarget?.path,
      connections: serializedConnections,
    };
    const hostWithSelectionSync = host as AppProps["host"] & {
      notifySelectionState?: (state: {
        selectedSourcePath?: string;
        selectedTargetPath?: string;
        connections?: unknown[];
      }) => void;
    };
    if (hostWithSelectionSync?.notifySelectionState) {
      hostWithSelectionSync.notifySelectionState(payload);
    } else {
      vscode.postMessage({
        command: "mapperSelectionState",
        type: "mapperSelectionState",
        payload,
      });
    }
  };
  useEffect(() => {
    if (!host) {
      return;
    }
    setProject({
      name: "New Mapping Project",
      sourceSchema: null,
      targetSchema: null,
      connections: [],
    });
    setGeneratedXSLT("");
    setShowXSLT(false);
    setSelectedSource(null);
    setSelectedTarget(null);
    const ctx = host.getContext();
    setAllowLoadXsd(ctx?.allowLoadXsd ?? false);
    setActivityName(ctx?.activityName ?? "");
    setActiveSchemaPaths({
      source: ctx?.sourcePath,
      target: ctx?.targetPath,
    });
    pendingXsltRef.current = null;
    schemasAwaitingXsltRef.current = false;

    if (ctx?.xslt?.trim()) {
      if (ctx.sourcePath || ctx.targetPath) {
        pendingXsltRef.current = ctx.xslt;
        schemasAwaitingXsltRef.current = true;
      } else {
        void applyXsltContent(ctx.xslt);
      }
    }

    const loadCachedSchema = (role: "source" | "target", path?: string) => {
      if (!path?.trim()) {
        return;
      }
      const cached = host.getCachedWorkspaceFile?.(path);
      if (cached?.trim()) {
        void loadXsdFromContent(cached, role, path);
      }
    };
    const loadAllCachedSourceSchemas = () => {
      const seen = new Set<string>();
      for (const entry of ctx?.sourceVariables ?? []) {
        const path = entry.schemaPath?.trim();
        if (!path || seen.has(path)) {
          continue;
        }
        seen.add(path);
        loadCachedSchema("source", path);
      }
      if (seen.size === 0) {
        loadCachedSchema("source", ctx?.sourcePath);
      }
    };
    loadAllCachedSourceSchemas();
    loadCachedSchema("target", ctx?.targetPath);

    const onWorkspaceFileUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        relativePath?: string;
        requestedPath?: string;
        requestedRole?: "source" | "target" | "xslt";
        content?: string;
      };
      const content = detail?.content?.trim();
      if (!content) {
        return;
      }
      if (detail.requestedRole === "source" || detail.requestedRole === "target") {
        void loadXsdFromContent(content, detail.requestedRole, detail.relativePath ?? detail.requestedPath);
      } else if (detail.requestedRole === "xslt") {
        void applyXsltContent(content);
      }
    };
    window.addEventListener("karavan-workspace-file-updated", onWorkspaceFileUpdated);

    const unsubscribe = host.subscribe((event) => {
      if (event.type === "xsltUpdated" && event.content) {
        void applyXsltContent(event.content);
      }
      if (event.type === "workspaceFile" && event.relativePath) {
        if (event.role === "source" || event.role === "target") {
          if (event.relativePath) {
            setActiveSchemaPaths((prev) => ({
              ...prev,
              [event.role === "source" ? "source" : "target"]: event.relativePath,
            }));
          }
          if (event.content?.trim()) {
            void loadXsdFromContent(event.content, event.role, event.relativePath);
          }
        } else if (event.role === "xslt" && event.content) {
          void applyXsltContent(event.content);
        }
      }
      if (event.type === "contextChanged" && event.context) {
        setAllowLoadXsd(event.context.allowLoadXsd ?? false);
        setActivityName(event.context.activityName ?? "");
        setActiveSchemaPaths({
          source: event.context.sourcePath,
          target: event.context.targetPath,
        });
        const reloadCachedSchema = (role: "source" | "target", path?: string) => {
          if (!path?.trim()) {
            return;
          }
          const cached = host.getCachedWorkspaceFile?.(path);
          if (cached?.trim()) {
            void loadXsdFromContent(cached, role, path);
          }
        };
        const reloadAllSourceSchemas = () => {
          const seen = new Set<string>();
          for (const entry of event.context.sourceVariables ?? []) {
            const path = entry.schemaPath?.trim();
            if (!path || seen.has(path)) {
              continue;
            }
            seen.add(path);
            reloadCachedSchema("source", path);
          }
          if (seen.size === 0) {
            reloadCachedSchema("source", event.context.sourcePath);
          }
        };
        reloadAllSourceSchemas();
        reloadCachedSchema("target", event.context.targetPath);
        if (event.context.xslt) {
          setGeneratedXSLT(event.context.xslt);
          setShowXSLT(true);
          void applyXsltContent(event.context.xslt);
        }
      }
    });

    return () => {
      window.removeEventListener("karavan-workspace-file-updated", onWorkspaceFileUpdated);
      unsubscribe();
    };
  }, [host]);

  useEffect(() => {
    if (!host || !schemasAwaitingXsltRef.current) {
      return;
    }
    const xslt = pendingXsltRef.current;
    if (!xslt?.trim()) {
      return;
    }
    if (!isRealSchema(project.sourceSchema, PLACEHOLDER_SOURCE)) {
      return;
    }
    pendingXsltRef.current = null;
    schemasAwaitingXsltRef.current = false;
    void applyXsltContent(xslt);
  }, [host, project.sourceSchema, project.targetSchema]);

  const loadXsltContent = async (content: string, options?: { silent?: boolean }) => {
    try {
      lastXsltContentRef.current = content;
      const mappings = xsltParser.parse(content);
      setXsltMappings(
        mappings.map((m) => ({
          sourcePath: m.sourcePath,
          targetPath: m.targetPath,
          expression: m.expression,
          isConditional: m.isConditional,
          condition: m.condition,
        })),
      );

      let schemaMsg = "";
      setProject((prev) => {
        let sourceSchema = prev.sourceSchema;
        let targetSchema = prev.targetSchema;
        const hasSourceSchema =
          sourceSchema &&
          sourceSchema?.nodes?.length &&
          sourceSchema?.nodes?.length > 0 &&
          sourceSchema.nodes[0].name !== "SourceSchema";
        const hasTargetSchema =
          targetSchema &&
          targetSchema?.nodes?.length &&
          targetSchema?.nodes?.length > 0 &&
          targetSchema.nodes[0].name !== "TargetSchema";

        if ((!hasSourceSchema || !hasTargetSchema) && mappings.length > 0) {
          const { sourceXSD, targetXSD } = xsltParser.constructSchemasFromMappings(mappings);
          const xsdParser = new XSDParser();
          if (!hasSourceSchema) {
            sourceSchema = xsdParser.parse(sourceXSD);
          }
          if (!hasTargetSchema) {
            targetSchema = xsdParser.parse(targetXSD);
          }
        }

        if (!sourceSchema || !targetSchema) {
          return prev;
        }

        const augmentedSource = augmentSourceSchemaFromMappings(
          sourceSchema,
          mappings,
          host?.getContext() ?? null,
        );
        if (augmentedSource) {
          sourceSchema = augmentedSource;
        }

        const connections =
          sourceSchema?.nodes &&
          targetSchema?.nodes &&
          xsltParser.convertToConnections(mappings, sourceSchema.nodes, targetSchema.nodes);

        schemaMsg =
          hasSourceSchema && hasTargetSchema ? "using pre-loaded schemas" : "and constructed schemas";

        return {
          ...prev,
          sourceSchema,
          targetSchema,
          connections: (connections ?? []) as IMappingConnection[],
        };
      });
      setTreeExpanded(true);
      setGeneratedXSLT(content);
      setOriginalLoadedXSLT(content);
      setShowXSLT(true);

      if (!options?.silent && mappings.length > 0) {
        alert(`✓ Successfully loaded XSLT with ${mappings.length} mappings ${schemaMsg}`);
      }
    } catch (error) {
      console.error("Error parsing XSLT:", error);
      if (!options?.silent) {
        alert(`Error parsing XSLT: ${error}`);
      }
    }
  };

  const applyXsltContent = async (content: string) => {
    await loadXsltContent(content, { silent: true });
  };

  const loadXsdFromContent = async (
    content: string,
    side: "source" | "target",
    relativePath?: string,
  ) => {
    if (!content.trim()) {
      return;
    }
    try {
      let schema = parser.parse(content);
      if (side === "source" && host && schema.nodes?.length) {
        const entry = resolveSourceVariableEntry(host.getContext(), relativePath);
        if (entry) {
          schema = {
            ...schema,
            nodes: wrapNodesWithVariable(schema.nodes, sourceVariableTreePath(entry)),
          };
        }
      }
      if (relativePath) {
        setActiveSchemaPaths((prev) => ({
          ...prev,
          [side === "source" ? "source" : "target"]: relativePath,
        }));
      }
      setProject((prev) => ({
        ...prev,
        sourceSchema:
          side === "source"
            ? {
                ...schema,
                nodes: mergeSourceRoots(prev.sourceSchema?.nodes, schema.nodes ?? []),
              }
            : prev.sourceSchema,
        targetSchema: side === "target" ? schema : prev.targetSchema,
      }));

      if (host && lastXsltContentRef.current?.trim()) {
        void loadXsltContent(lastXsltContentRef.current, { silent: true });
      }
    } catch (error) {
      console.error(`Error parsing ${side} XSD:`, error);
    }
  };

  // Sync mapper theme with VS Code light/dark
  useEffect(() => {
    const applyTheme = (message?: { value?: number; isDark?: boolean }) => {
      const isDark = resolveVsCodeThemeDark(message);
      setThemeDark(isDark);
      applyMapperDarkClass(isDark);
    };

    applyTheme();

    const onMessage = (event: MessageEvent) => {
      if (isThemeMessage(event.data)) {
        applyTheme(event.data);
      }
    };

    window.addEventListener("message", onMessage);
    const stopWatchingBody = watchVsCodeBodyTheme(() => applyTheme());

    return () => {
      window.removeEventListener("message", onMessage);
      stopWatchingBody();
    };
  }, []);

  // Handle XSLT updates and mapper selection sync
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (isThemeMessage(event.data)) {
        return;
      } else if (event.data?.type === "xsltUpdated" || event.data?.command === "xsltUpdated") {
        const updatedXSLT = event.data.content;
        if (updatedXSLT?.trim()) {
          setGeneratedXSLT(updatedXSLT);
          setShowXSLT(true);
          void applyXsltContent(updatedXSLT, { silent: true });
        }
      } else if (event.data?.type === "mapperSelectionStateSync") {
        if (transformationDialogOpen) {
          return;
        }
        const payload = event.data.payload as {
          selectedSourcePath?: string;
          selectedTargetPath?: string;
          connections?: IMappingConnection[];
        } | undefined;
        if (!payload) {
          return;
        }
        if (isSecondaryPanel) {
          setSyncedSelectionPaths((prev) => ({
            source:
              payload.selectedSourcePath !== undefined
                ? payload.selectedSourcePath
                : prev.source,
            target:
              payload.selectedTargetPath !== undefined
                ? payload.selectedTargetPath
                : prev.target,
          }));
        } else {
          setSelectedSource((prev) => {
            if (payload.selectedSourcePath === undefined) {
              return prev;
            }
            if (!payload.selectedSourcePath) {
              return null;
            }
            return (
              findNodeByPath(project.sourceSchema?.nodes, payload.selectedSourcePath) ?? prev
            );
          });
          setSelectedTarget((prev) => {
            if (payload.selectedTargetPath === undefined) {
              return prev;
            }
            if (!payload.selectedTargetPath) {
              return null;
            }
            return (
              findNodeByPath(project.targetSchema?.nodes, payload.selectedTargetPath) ?? prev
            );
          });
        }
        if (Array.isArray(payload.connections)) {
          const syncedConnections = payload.connections as IMappingConnection[];
          setProject((prev) => ({ ...prev, connections: syncedConnections }));
        }
      } else if (event.data?.type === "mapperSelectionAction") {
        const action = event.data.action as string | undefined;
        if (!action) {
          return;
        }
        if (action === "createMapping") {
          handleCreateMapping();
        } else if (action === "deleteAllMappings") {
          handleDeleteAllMappings();
        } else if (action === "deleteMapping" && typeof event.data.connectionId === "string") {
          handleDeleteMapping(event.data.connectionId);
        } else if (action === "editMapping" && typeof event.data.connectionId === "string") {
          const connection = project.connections.find((conn) => conn.id === event.data.connectionId);
          if (connection) {
            handleEditTransformation(connection);
          }
        } else if (
          action === "saveConnectionTransformation" &&
          typeof event.data.connectionId === "string" &&
          event.data.transformation
        ) {
          applyConnectionTransformation(
            event.data.connectionId,
            event.data.transformation as IMappingTransformation,
          );
        } else if (action === "openXsltInEditor") {
          handleOpenXSLTInEditor();
        } else if (action === "highlightMapping" && typeof event.data.connectionId === "string") {
          setHighlightedConnectionId(event.data.connectionId);
        } else if (action === "clearHighlightMapping") {
          setHighlightedConnectionId(null);
        }
      } else if (event.data?.command === "requestMapperSelectionState") {
        publishSelectionState();
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [
    project.connections,
    project.sourceSchema,
    project.targetSchema,
    selectedSource,
    selectedTarget,
    transformationDialogOpen,
  ])

  useEffect(() => {
    if (transformationDialogOpen) {
      return;
    }
    publishSelectionState();
  }, [
    host,
    isSecondaryPanel,
    project.connections,
    selectedSource?.path,
    selectedTarget?.path,
    transformationDialogOpen,
  ])

  useEffect(() => {
    if (isSecondaryPanel) {
      vscode.postMessage({ command: "selectionPanelReady" });
    }
  }, [isSecondaryPanel, vscode]);


  useEffect(() => {
    if (host) {
      return;
    }
    const sourceXSD = parser.generateEmptyXSD("SourceSchema")
    const targetXSD = parser.generateEmptyXSD("TargetSchema")

    try {
      const sourceSchema = parser.parse(sourceXSD)
      const targetSchema = parser.parse(targetXSD)

      setProject((prev) => ({
        ...prev,
        sourceSchema,
        targetSchema,
      }))
    } catch (error) {
      console.error("Error loading empty schemas:", error)
    }
  }, [host])

  const handleFileUpload = async (file: File, side: MappedNodeIDs) => {

    const content = await file.text()
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(content, "text/xml")
    const rootElement = xmlDoc.documentElement

    enum XSLTFileType {
      StyleSheet = "xsl:stylesheet",
      TransForm = "xsl:transform",
      StylesHeetNoPrefix = "stylesheet",
      TransformNoPrefix = "transform"
    }

    // Check if this is an XSLT file instead of XSD
    if (
      rootElement.nodeName === XSLTFileType.StyleSheet ||
      rootElement.nodeName === XSLTFileType.TransForm ||
      rootElement.localName === XSLTFileType.StylesHeetNoPrefix ||
      rootElement.localName === XSLTFileType.TransformNoPrefix

    ) {
      alert(
        "❌ This appears to be an XSLT file, not an XSD schema. Please use the 'Load XSLT' button to load XSLT files.",
      )
      setTreeExpanded(true)
      return
    }
    enum XSDFileType {
      XSSchema = "xs:schema",
      XSDSchema = "xsd:schema",
      Schema = "schema"
    }

    // Check if this is a valid XSD schema
    if (
      rootElement.nodeName !== XSDFileType.XSSchema &&
      rootElement.nodeName !== XSDFileType.XSDSchema &&
      rootElement.nodeName !== XSDFileType.Schema &&
      rootElement.localName !== XSDFileType.Schema
    ) {
      alert(
        `❌ Invalid XSD file. Root element is '${rootElement.nodeName}' but expected 'xs:schema' or 'xsd:schema'. Please upload a valid XSD schema file.`,
      )
      return
    }

    try {
      const xsdParser = new XSDParser()
      const schema = xsdParser.parse(content)
      setTreeExpanded(true)
      setProject((prev) => ({
        ...prev,
        [side === "source" ? "sourceSchema" : "targetSchema"]: schema,
      }))
      alert(`✓ Successfully loaded ${side} schema: ${file.name}`)

    } catch (error) {
      console.error(`Error parsing ${side} XSD:`, error)
      alert(`Error parsing XSD: ${error}`)
    }
  }

  const handleDragStart = (node: IXSDNode) => {
    setDraggedSource(node)
  }

  const handleDrop = (targetNode: IXSDNode) => {
    if (!draggedSource) return

    // console.log("Creating mapping via drag-and-drop:")
    // console.log("Source:", draggedSource.path)
    // console.log("Target:", targetNode.path)

    setOriginalLoadedXSLT(null) // New mapping added, clear original

    const newConnection: IMappingConnection = {
      id: `conn-${Date.now()}`,
      sourceId: draggedSource.id,
      targetId: targetNode.id,
      sourcePath: draggedSource.path,
      targetPath: targetNode.path,
      type: MappingTransformationType.DIRECT,
    }

    setProject((prev) => ({
      ...prev,
      connections: [...prev.connections, newConnection],
    }))

    setDraggedSource(null)
  }

  const handleCreateMapping = () => {
    if (!selectedSource || !selectedTarget) {
      alert("Please select both source and target nodes")
      return
    }

    const newConnection: IMappingConnection = {
      id: `conn-${Date.now()}`,
      sourceId: selectedSource.id,
      targetId: selectedTarget.id,
      sourcePath: selectedSource.path,
      targetPath: selectedTarget.path,
      type: MappingTransformationType.DIRECT,
    }

    console.log("New connection created:", newConnection)

    // Open transformation dialog to configure the mapping
    setEditingConnection(newConnection)
    setTransformationDialogOpen(true)
  }

  enum InputType {
    FILE = "file",
    JSON = ".json"
  }
  enum InputAccepts {
    XSLT = ".xslt,.xsl,.xml",
    XML = ".xml",
    XSL = ".xsl",
    JSON = ".json"
  }
  const handleLoadExistingProject = () => {
    const input = document.createElement("input")
    input.type = InputType.FILE
    input.accept = InputAccepts.JSON
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) handleLoadProject(file)
    }
    input.click()
  }

  const handleLoadXSLT = () => {
    if (host) {
      const ctx = host.getContext();
      if (ctx?.xslt?.trim()) {
        void applyXsltContent(ctx.xslt);
        return;
      }
      host.pickWorkspaceFile("xslt", [".xslt", ".xsl", ".xml"]);
      return;
    }

    const input = document.createElement("input")
    input.type = InputType.FILE
    input.accept = InputAccepts.XSLT
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        handleResetMappings()
        void handleXSLTUpload(file)
      }
    }
    input.click()
  }

  const applyConnectionTransformation = (
    connectionId: string,
    transformation: IMappingTransformation,
  ) => {
    setOriginalLoadedXSLT(null);
    setGeneratedXSLT("");
    setShowXSLT(false);

    const existingIndex = project.connections.findIndex((c) => c.id === connectionId);
    if (existingIndex < 0) {
      return;
    }

    setProject((prev) => ({
      ...prev,
      connections: prev.connections.map((c) =>
        c.id === connectionId
          ? { ...c, transformation, type: transformation.type }
          : c,
      ),
    }));
  };

  const handleSaveTransformation = (transformation: IMappingTransformation) => {
    if (!editingConnection) return

    applyConnectionTransformation(editingConnection.id, transformation);

    const existingIndex = project.connections.findIndex((c) => c.id === editingConnection.id);
    if (existingIndex < 0) {
      setProject((prev) => ({
        ...prev,
        connections: [
          ...prev.connections,
          {
            ...editingConnection,
            transformation,
            type: transformation.type,
          },
        ],
      }));
    }

    setSelectedSource(null)
    setSelectedTarget(null)
    setEditingConnection(null)
    setTransformationDialogOpen(false)
  }

  const handleEditTransformation = (connection: IMappingConnection) => {
    setEditingConnection({
      ...connection,
      transformation: connection.transformation
        ? { ...connection.transformation }
        : { type: MappingTransformationType.DIRECT, customXPath: connection.sourcePath },
    })
    setTransformationDialogOpen(true)
  }

  const handleGenerateXSLT = () => {
    if (!project.sourceSchema || !project.targetSchema) {
      alert("Please load both source and target schemas")
      return
    }

    // Generate new XSLT from mappings
    const xslt = generator.generate(
      project.connections as any,
      project.targetSchema.nodes as any,
      project.sourceSchema.targetNamespace,
      project.targetSchema.targetNamespace,
    )

    setGeneratedXSLT(xslt)
    setShowXSLT(true)
    lastXsltContentRef.current = xslt
  }

  const handleDeleteMapping = (connectionId: string) => {
    if (isSelectionPanelMode && isSecondaryPanel) {
      vscode.postMessage({ type: "mapperSelectionAction", action: "deleteMapping", connectionId });
      return;
    }
    setOriginalLoadedXSLT(null) // Mappings changed, clear original
    setProject((prev) => ({
      ...prev,
      connections: prev.connections.filter((c) => c.id !== connectionId),
    }))
  }

  const handleDeleteAllMappings = () => {
    if (isSelectionPanelMode && isSecondaryPanel) {
      vscode.postMessage({ type: "mapperSelectionAction", action: "deleteAllMappings" });
      return;
    }
    setOriginalLoadedXSLT(null) // Mappings changed, clear original
    setProject((prev) => ({
      ...prev,
      connections: [],
    }))
  }

  const handleResetMappings = (schema?: "source" | "target") => {
    try {
      const xsdParser = new XSDParser()

      // Clear original loaded XSLT since we're resetting
      setOriginalLoadedXSLT(null)
      pendingXsltRef.current = null
      schemasAwaitingXsltRef.current = false

      if (schema && schema == "source") {
        const sourceXSD = xsdParser.generateEmptyXSD("SourceSchema")
        const sourceSchema = xsdParser.parse(sourceXSD)
        setProject((prev) => ({
          ...prev,
          sourceSchema,

          connections: [],
        }))

      } else if (schema && schema == "target") {
        const targetXSD = xsdParser.generateEmptyXSD("TargetSchema")
        const targetSchema = xsdParser.parse(targetXSD)
        setProject((prev) => ({
          ...prev,
          targetSchema,

          connections: [],
        }))
      } else {

        const targetXSD = xsdParser.generateEmptyXSD("TargetSchema")
        const sourceXSD = xsdParser.generateEmptyXSD("SourceSchema")
        // Parse the XSD strings into schema objects
        const sourceSchema = xsdParser.parse(sourceXSD)
        const targetSchema = xsdParser.parse(targetXSD)
        setSelectedSource(null)
        setSelectedTarget(null)
        setProject((prev) => ({
          ...prev,
          sourceSchema,
          targetSchema,
          connections: [],
        }))
      }

      setGeneratedXSLT("")
      setShowXSLT(false)
    } catch (error) {
    }
  }

  const handleDownloadXSLT = () => {
    const blob = new Blob([generatedXSLT], { type: "text/xml" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "mapping.xslt"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveProject = () => {
    handleGenerateXSLT()
    handleDownloadXSLT()

  }

  const handleLoadProject = async (file: File) => {
    try {
      const content = await file.text()
      const loadedProject = JSON.parse(content) as IMapperProject
      setProject(loadedProject)

      alert(`✓ Successfully loaded project: ${loadedProject.name}`)
    } catch (error) {
      alert(`Error loading project: ${error}`)
    }
  }

  const handleUploadXSD = (side: MappedNodeIDs) => {
    if (host && !allowLoadXsd) {
      return;
    }
    if (host) {
      host.pickWorkspaceFile(side === MappedNodeIDs.Source ? "source" : "target", [".xsd", ".xml", ".wsdl"]);
      return;
    }

    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".xsd,.xml"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        handleResetMappings(side === MappedNodeIDs.Source ? "source" : "target"),
          handleFileUpload(file, side)
      }
    }
    input.click()
  }



  const resolveXsltContent = (): string => {
    if (generatedXSLT?.trim()) {
      return generatedXSLT;
    }
    const ctxXslt = host?.getContext()?.xslt;
    if (ctxXslt?.trim()) {
      return ctxXslt;
    }
    if (project.sourceSchema?.nodes && project.targetSchema?.nodes && project.connections.length > 0) {
      return generator.generate(
        project.connections as any,
        project.targetSchema.nodes as any,
        project.sourceSchema.targetNamespace,
        project.targetSchema.targetNamespace,
      );
    }
    return "";
  };

  const handleOpenXSLTInEditor = () => {
    const xslt = resolveXsltContent();
    if (!xslt.trim()) {
      alert("Generate or load XSLT first");
      return;
    }

    if (!generatedXSLT?.trim()) {
      setGeneratedXSLT(xslt);
      setShowXSLT(true);
    }

    if (host) {
      host.openXsltInEditor(xslt);
      return;
    }

    vscode.postMessage({
      command: "openXSLTPreview",
      type: "openXSLTPreview",
      content: xslt,
      draft: true,
    });
  };

  const handleSaveToKaravanActivity = () => {
    if (!host) {
      return;
    }
    const xslt = generatedXSLT?.trim() || lastXsltContentRef.current?.trim() || "";
    if (!xslt) {
      alert("Generate or edit XSLT first, then save to activity.");
      return;
    }
    setGeneratedXSLT(xslt);
    setShowXSLT(true);
    setOriginalLoadedXSLT(null);
    lastXsltContentRef.current = xslt;
    const ctx = host.getContext();
    host.saveToActivity({
      xslt,
      sourcePath: activeSchemaPaths.source ?? ctx?.sourcePath,
      targetPath: activeSchemaPaths.target ?? ctx?.targetPath,
    });
  }

  const handleXSLTUpload = async (file: File) => {
    const content = await file.text();
    await loadXsltContent(content);
  };



  // Get color for a specific connection
  const getConnectionColor = (connectionId: string): string => {
    const index = project.connections.findIndex(c => c.id === connectionId)
    if (index === -1) {
      return connectionColors[0]
    }
    const color = connectionColors[index % connectionColors.length]
    return color
  }

  // Get mapped node IDs with their connection colors
  const getMappedNodeIds = (side: MappedNodeIDs): Map<string, string> => {
    const nodeColorMap = new Map<string, string>()
    project.connections.forEach((conn) => {
      const nodeId = side === MappedNodeIDs.Target ? conn.targetId : conn.sourceId
      const color = getConnectionColor(conn.id)
      nodeColorMap.set(nodeId, color)
    })
    return nodeColorMap
  }

  const ActionButtons = [{
    variant: ButtonVariant.Default,
    icon: <LuSave className="h-4 w-4 mr-2" />,
    label: 'Save to Activity',
    method: handleSaveToKaravanActivity,
    disabled: !isKaravanEmbedded,
    hidden: !isKaravanEmbedded,
  },
  // TIBCO-style mapper flow does not use custom "project file" save/load actions.
  // {
  //   variant: ButtonVariant.Outline,
  //   icon: <LuSave className="h-4 w-4 mr-2" />,
  //   label: 'Save project ',
  //   method: handleSaveProject,
  //   disabled: !project.sourceSchema || !project.targetSchema
  // },
  // {
  //   variant: ButtonVariant.Outline,
  //   icon: <LuFolderOpen className="h-4 w-4 mr-2" />,
  //   label: 'Load project',
  //   method: handleLoadExistingProject,
  //   disabled: false
  // },
  {
    variant: ButtonVariant.Outline,
    icon: <LuWorkflow className="h-4 w-4 mr-2" />,
    label: 'Load XSLT',
    method: handleLoadXSLT,
    disabled: false
  },
  {
    variant: ButtonVariant.Default,
    icon: <LuFileCode className="h-4 w-4 mr-2" />,
    label: 'Generate XSLT',
    method: handleGenerateXSLT,
    disabled: false
  },
  {
    variant: ButtonVariant.Outline,
    icon: <LuRefreshCcw className="h-4 w-4 mr-2" />,
    label: 'Reset',
    method: () => handleResetMappings(),
    disabled: false
  },
  {
    variant: ButtonVariant.Outline,
    icon: <VscVscodeInsiders className="h-4 w-4 mr-2" />,
    label: 'Open in VS Code',
    method: handleOpenXSLTInEditor,
    disabled: false,
    hidden: !isKaravanEmbedded,
  }]

  const displayedSourcePath = isSecondaryPanel
    ? syncedSelectionPaths.source
    : selectedSource?.path;
  const displayedTargetPath = isSecondaryPanel
    ? syncedSelectionPaths.target
    : selectedTarget?.path;
  const canCreateMapping = Boolean(displayedSourcePath && displayedTargetPath);

  const postHighlightMapping = (connectionId: string | null) => {
    setHighlightedConnectionId(connectionId);
    if (isSecondaryPanel) {
      vscode.postMessage({
        type: "mapperSelectionAction",
        action: connectionId ? "highlightMapping" : "clearHighlightMapping",
        connectionId: connectionId ?? undefined,
      });
    }
  };

  const schemaTreeViewportClass = cn(
    "rounded-md border border-border p-2 overflow-y-auto",
    isKaravanEmbedded
      ? " h-full"
      : "h-[600px]",
  );

  const MappingControls = (
    <Card className={isSelectionPanelMode ? " h-full p-4" : "mt-6 p-4 h-full"}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="font-semibold mb-2">Current Selection</h3>
          <div className="grid grid-cols-2 gap-4 text-base">
            <div>
              <span className="text-muted-foreground">Source: </span>
              <span className="font-mono">{displayedSourcePath || "None"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Target: </span>
              <span className="font-mono">{displayedTargetPath || "None"}</span>
            </div>
          </div>
        </div>
        <span className="flex flex-row gap-2">
          <Button onClick={() => {
            if (isSelectionPanelMode && isSecondaryPanel) {
              vscode.postMessage({ type: "mapperSelectionAction", action: "createMapping" });
              return;
            }
            handleCreateMapping();
          }} disabled={!canCreateMapping} className="cursor-pointer">
            Create Mapping
          </Button>
          <Button onClick={handleDeleteAllMappings} disabled={project.connections.length === 0} variant={ButtonVariant.Outline} className="cursor-pointer">
            <LuTrash2 className="h-4 w-4 mr-2" /> Delete All Mappings
          </Button>
          {isSecondaryPanel && (
            <Button
              variant={ButtonVariant.Outline}
              onClick={() => {
                vscode.postMessage({ type: "mapperSelectionAction", action: "openXsltInEditor" });
              }}
              className="cursor-pointer"
            >
              <VscVscodeInsiders className="h-4 w-4 mr-2" />
              Open in VS Code
            </Button>
          )}
        </span>
      </div>

      <div className="mt-4 h-full">
        <h3 className="font-semibold mb-2">Mappings ({project.connections.length})</h3>
        <div className="space-y-1 max-h-full overflow-auto">
          {project.connections.map((conn) => {
            const color = getConnectionColor(conn.id)
            const connectionHighlight = `color-mix(in oklch, ${color} 15%, transparent)`
            return (
               <Tooltip key={conn.id}>
      <TooltipTrigger asChild>
              <div
                className={cn(
                  "text-base font-mono p-2 rounded flex items-center justify-between gap-2 w-full text-start duration-200 ease-in-out transition-all shadow-sm",
                  highlightedConnectionId === conn.id && "ring-2 ring-foreground/25 scale-[1.01]",
                )}
                style={{ backgroundColor: connectionHighlight }}
                onMouseEnter={() => postHighlightMapping(conn.id)}
                onMouseLeave={() => postHighlightMapping(null)}
              >
                <span className="flex-1 truncate">
                  <span className="font-semibold">{conn.sourcePath}</span> → <span className="font-semibold">{conn.targetPath}</span>
                  {conn.transformation && (
                    <span className="ml-2 text-sm text-blue-600 dark:text-blue-400">
                      [{conn.transformation?.type}]
                    </span>
                  )}
                </span>
                <div className="flex gap-1">
                  <Button
                    className="cursor-pointer"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (isSelectionPanelMode && isSecondaryPanel) {
                        vscode.postMessage({
                          type: "mapperSelectionAction",
                          action: "editMapping",
                          connectionId: conn.id,
                        });
                        return;
                      }
                      handleEditTransformation(conn);
                    }}
                    title="Edit transformation"
                  >
                    <LuSettings2 className="h-3 w-3" />
                  </Button>
                  <Button
                    className="cursor-pointer"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteMapping(conn.id)}
                    title="Delete mapping"
                  >
                    <LuTrash2 className="h-3 w-3" />
                  </Button>
                </div>
                  </div>
               </TooltipTrigger>
              <TooltipContent
                className="bg-background"
                arrowStyle={{ backgroundColor: connectionHighlight, fill: connectionHighlight }}
              >
            <div className="flex flex-col gap-2 text-white">
         <p className="flex flex-row gap-2"><span className="font-semibold">Source:</span><span>{conn?.sourcePath}</span></p>
         <p className="flex flex-row gap-2"><span className="font-semibold">Target:</span><span>{conn?.targetPath}</span></p>
         <p className="flex flex-row gap-2"><span className="font-semibold">Type:</span><span>{conn?.transformation?.type}</span></p>
  </div>
       </TooltipContent>
     </Tooltip>
            )
          })}
        </div>
      </div>
    </Card>
  );

  if (isSelectionPanelMode) {
    return (
      <div className="min-h-full bg-background px-3 py-3">
        {MappingControls}
      </div>
    );
  }
  // Get connection targets map (sourceId -> array of targetIds)
  return (
     <TooltipProvider>
    <div
      className={cn(
        "bg-background",
        isKaravanEmbedded ? "flex h-full min-h-0 flex-col" : "min-h-screen",
      )}
    >
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className={isKaravanEmbedded ? "px-3 py-2" : "container mx-auto px-4 py-4"}>
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex flex-col items-center md:items-start">
              {/* <h1 className={isKaravanEmbedded ? "text-lg font-semibold text-foreground" : "text-3xl font-semibold text-foreground"}>{isKaravanEmbedded ? "Karavan Mapper" : "XSLT Mapper"}</h1>
              <p className={isKaravanEmbedded ? "text-sm text-muted-foreground" : "text-base text-muted-foreground"}>
             
              </p> */}
            </div>
            <div className="flex py-4 flex-col gap-2 md:flex-row">
              <div className="flex flex-row gap-1 justify-center">
                {
                  ActionButtons.filter((btn) => !btn.hidden).slice(0, isKaravanEmbedded ? 3 : 2).map((btn, index) => (
                    <Button
                      className="cursor-pointer"
                      key={index}
                      variant={btn.variant}
                      onClick={btn.method}
                      disabled={btn.disabled}
                    >
                      {btn.icon}
                      {btn.label}
                    </Button>
                  ))
                }
              </div>
              <div className="flex flex-row gap-1">
                {ActionButtons.filter((btn) => !btn.hidden).slice(isKaravanEmbedded ? 3 : 2).map((btn, index) => (
                  <Button
                    className="cursor-pointer"
                    key={index}
                    variant={btn.variant}
                    onClick={btn.method}
                    disabled={btn.disabled}
                  >
                    {btn.icon}
                    {btn.label}
                  </Button>
                ))
                }
              </div>
            </div>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <div
        className={cn(
          isKaravanEmbedded
            ? "flex min-h-0 flex-1 flex-col px-3 py-3"
            : "container mx-auto px-4 py-6",
        )}
      >
        {/* Tabs for tree view and flow view */}
        <div
          value={viewMode}
          onValueChange={(v) => setViewMode(v as ViewMode)}
          className={cn(isKaravanEmbedded ? "flex min-h-0 flex-1 flex-col" : "mb-6")}
        >
          {/* <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))
            }
          </TabsList> */}

          {/* Tree View Tab */}
            <div className={cn(isKaravanEmbedded ? "flex min-h-0 flex-1 flex-col pb-6" : "mt-6")}>
              <Card className="flex flex-row w-full justify-center items-center pb-6 ">
                <h1 className="text-lg text-muted-foreground font-bold">
                  {isKaravanEmbedded && activityName ? activityName : "Mapping"}
                </h1>
                </Card>
            <div
              ref={treeContainerRef}
              className={cn(
                "relative overflow-visible",
                isKaravanEmbedded && "flex min-h-0 flex-1 flex-col",
              )}
            >
              <ConnectionLines
                connections={project.connections}
                containerRef={treeContainerRef}
                getConnectionColor={getConnectionColor}
                highlightedConnectionId={highlightedConnectionId}
                />
                
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 h-full mb-10">
                  {/* Source Schema */}
                  
                <Card className={cn("gap-2 p-4 py-4", isKaravanEmbedded && "min-h-0")}>
                  <div className="flex items-center justify-between pb-4">
                    <h2 className="text-xl font-semibold">Source Schema</h2>
                    {allowLoadXsd && (
                    <Button
                      className="cursor-pointer"
                      size="sm"
                      variant="outline"
                      onClick={() => handleUploadXSD(MappedNodeIDs.Source)}
                    >
                      <LuUpload className="h-4 w-4 mr-2" />
                      Load XSD
                    </Button>
                    )}
                  </div>
                  <div className={schemaTreeViewportClass} ref={leftSchemaListRef}>
                    {project.sourceSchema && project.sourceSchema.nodes ? (
                      <SchemaTree
                        isTreeExpanded={treeExpanded}
                        nodes={project.sourceSchema.nodes}
                        onNodeClick={(node) => setSelectedSource(node)}
                        selectedNodeId={selectedSource?.id}
                        side={MappedNodeIDs.Source}
                        onDragStart={handleDragStart}
                        mappedNodeIds={getMappedNodeIds(MappedNodeIDs.Source)}
                        highlightedConnectionId={highlightedConnectionId}
                        connections={project.connections}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Load a source XSD schema
                      </div>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    💡 Drag elements from source to target to create mappings
                  </p>
                </Card>

                {/* Target Schema */}
                <Card className={cn("gap-2 p-4 py-4", isKaravanEmbedded && "min-h-0")}>
                  <div className="flex items-center justify-between pb-4">
                    <h2 className="text-xl font-semibold">Target Schema</h2>
                    {allowLoadXsd && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => handleUploadXSD(MappedNodeIDs.Target)}
                    >
                      <LuUpload className="h-4 w-4 mr-2" />
                      Load XSD
                    </Button>
                    )}
                  </div>
                  <div className={cn(schemaTreeViewportClass, "bg-muted/20")}>
                    {project.targetSchema && project.targetSchema.nodes ? (
                      <SchemaTree
                        isTreeExpanded={treeExpanded}
                        nodes={project.targetSchema.nodes}
                        onNodeClick={setSelectedTarget}
                        selectedNodeId={selectedTarget?.id}
                        side={MappedNodeIDs.Target}
                        onDrop={handleDrop}
                        mappedNodeIds={getMappedNodeIds(MappedNodeIDs.Target)}
                        highlightedConnectionId={highlightedConnectionId}
                        connections={project.connections}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Load a target XSD schema
                      </div>
                    )}
                  </div>
                    <p className="text-sm text-muted-foreground mt-2">
                    💡 Drag elements from source to target to create mappings
                  </p>
                </Card>
              </div>
            </div>
          </div>

          {/* Flow Diagram Tab
          <div  className="mt-6">
            <Card className="p-4">
              <h2 className="text-xl font-semibold mb-4">XSLT Flow Visualization</h2>
              {project.sourceSchema && project.targetSchema ? (
                <FlowVisualizer
                  sourceNodes={project.sourceSchema?.nodes}
                  targetNodes={project.targetSchema?.nodes}
                  connections={project.connections}
                  getConnectionColor={getConnectionColor}
                  xsltMappings={xsltMappings}
                />
              ) : (
                <div className="flex items-center justify-center h-[600px] border border-border rounded-md bg-muted/20 text-muted-foreground">
                  Load source and target schemas to view flow diagram
                </div>
              )}
            </Card>
          </div> */}
        </div>

        {/* Mapping controls live in the VS Code bottom panel when embedded in Karavan */}
        {!isKaravanEmbedded && MappingControls}

        {/* XSLT Output */}
        {/* {showXSLT && (
          <Card className="mt-6 p-4 h-full">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Generated XSLT</h3>
              <span>
                {typeof window !== 'undefined' && typeof document !== 'undefined' && <Button
                  className="cursor-pointer"
                  size="sm"
                  variant="ghost"
                  onClick={() => setSheetOpen(true)}
                  title="Edit transformation"
                >
                  Open preview editor
                </Button> }
                
                <Button size="sm" onClick={handleOpenXSLTInEditor} disabled={!generatedXSLT} className="cursor-pointer">
                  <VscVscodeInsiders className="h-6 w-6 mr-2" />
                  Open in VS Code
                </Button></span>

              <Button size="sm" onClick={handleDownloadXSLT} className="cursor-pointer">
                <LuDownload className="h-6 w-6 mr-2" />
                Download
              </Button>
            </div>
            <div className="w-full overflow-auto rounded-md border bg-muted/30 p-4 max-h-[500px]">
              <Highlight
                theme={themeDark ? themes.vsDark : themes.oneLight}
                code={generatedXSLT}
                language="xml"
              >
                {({ className, style, tokens, getLineProps, getTokenProps }) => (
                  <pre className={className} style={style}>
                    {tokens.map((line, i) => (
                      <div key={i} {...getLineProps({ line })}>
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </div>
                    ))}
                  </pre>
                )}
              </Highlight>
            </div>
          </Card>
        )} */}
      </div>

      <SheetEditor sheetOpen={sheetOpen} title="XSLT Output">
        <Highlight
          theme={themeDark ? themes.vsDark : themes.oneLight}
          code={generatedXSLT}
          language="xml"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre className={className} style={style}>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </SheetEditor>
      {/* Transformation Dialog */}
      {editingConnection && (
        <TransformationDialog
          open={transformationDialogOpen}
          onOpenChange={setTransformationDialogOpen}
          sourcePath={editingConnection.sourcePath}
          targetPath={editingConnection.targetPath}
          currentTransformation={editingConnection.transformation}
          onSave={handleSaveTransformation}
        />
      )}
    </div>
  </TooltipProvider>);
}

export default App;

