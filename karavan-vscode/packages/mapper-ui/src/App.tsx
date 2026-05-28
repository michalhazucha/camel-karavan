import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ButtonVariant, MappingTransformationType, type IMapperProject, type IMappingConnection, type IMappingTransformation, type IXSDNode } from "@/lib/types";
import { Highlight, themes } from "prism-react-renderer";
import { useEffect, useRef, useState } from "react";
import { LuDownload, LuFileCode, LuFolderOpen, LuRefreshCcw, LuSave, LuSettings2, LuTrash2, LuUpload, LuWorkflow, } from "react-icons/lu";
import { VscVscodeInsiders } from "react-icons/vsc";
import { ConnectionLines } from "./components/connection-lines";
import { FlowVisualizer } from "./components/flow-visualizer";
import { SchemaTree } from "./components/schema-tree";
import SheetEditor from "./components/SheetEditor";
import { TransformationDialog } from "./components/transformation-dialog";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { MappedNodeIDs, tabs, ViewMode } from "./lib/constants";
import { XSLTGenerator, XSDParser, XSLTParser } from "@karavan/mapper-core";
import { connectionColors } from "./lib/variables";
import type { KaravanMapperHost } from "./karavan-host";


declare const acquireVsCodeApi: () => {
  postMessage: (message: any) => void;
};

const createStandaloneVsCodeApi = () => ({
  postMessage: (message: any) => {
    console.log("VSCode message:", message);
  },
});

interface AppProps {
  host?: KaravanMapperHost;
}

function App({ host }: AppProps) {
  const isKaravanEmbedded = Boolean(host);
  const vscode: { postMessage: (message: unknown) => void } =
    typeof acquireVsCodeApi === "function" && !host
      ? acquireVsCodeApi()
      : createStandaloneVsCodeApi();
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
  const [themeDark, setThemeDark] = useState<boolean>(false)
  const [xsltMappings, setXsltMappings] = useState<Array<{
    sourcePath: string
    targetPath: string
    isConditional?: boolean
    condition?: string
  }>
  >([])
  const [originalLoadedXSLT, setOriginalLoadedXSLT] = useState<string | null>(null)
  const [activeSchemaPaths, setActiveSchemaPaths] = useState<{ source?: string; target?: string }>({})
  const pendingXsltRef = useRef<string | null>(null)
  const schemasAwaitingXsltRef = useRef(false)

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
  useEffect(() => {
    if (!host) {
      return;
    }
    const ctx = host.getContext();
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
    loadCachedSchema("source", ctx?.sourcePath);
    loadCachedSchema("target", ctx?.targetPath);

    return host.subscribe((event) => {
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
        setActiveSchemaPaths({
          source: event.context.sourcePath,
          target: event.context.targetPath,
        });
        if (event.context.xslt) {
          setGeneratedXSLT(event.context.xslt);
          setShowXSLT(true);
        }
      }
    });
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
    if (!isRealSchema(project.targetSchema, PLACEHOLDER_TARGET)) {
      return;
    }
    pendingXsltRef.current = null;
    schemasAwaitingXsltRef.current = false;
    void applyXsltContent(xslt);
  }, [host, project.sourceSchema, project.targetSchema]);

  const loadXsltContent = async (content: string, options?: { silent?: boolean }) => {
    try {
      const mappings = xsltParser.parse(content);
      setXsltMappings(
        mappings.map((m) => ({
          sourcePath: m.sourcePath,
          targetPath: m.targetPath,
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

        if (!hasSourceSchema || !hasTargetSchema) {
          const { sourceXSD, targetXSD } = xsltParser.constructSchemasFromMappings(mappings);
          const xsdParser = new XSDParser();
          sourceSchema = xsdParser.parse(sourceXSD);
          targetSchema = xsdParser.parse(targetXSD);
        }

        if (!sourceSchema || !targetSchema) {
          throw new Error("Failed to load or construct schemas");
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

      if (!options?.silent) {
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
      const schema = parser.parse(content);
      if (relativePath) {
        setActiveSchemaPaths((prev) => ({
          ...prev,
          [side === "source" ? "source" : "target"]: relativePath,
        }));
      }
      setProject((prev) => ({
        ...prev,
        sourceSchema: side === "source" ? schema : prev.sourceSchema,
        targetSchema: side === "target" ? schema : prev.targetSchema,
      }));
    } catch (error) {
      console.error(`Error parsing ${side} XSD:`, error);
    }
  };

  //gettheme and handle XSLT updates
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "theme") {
        const isDark = event.data.value === 2
        setThemeDark(isDark)
        document.querySelectorAll(".karavan-mapper-root").forEach((el) => {
          el.classList.toggle("dark", isDark)
        })
      } else if (event.data?.type === "xsltUpdated") {
        // XSLT was edited and saved in VS Code editor
        console.log("📥 Received updated XSLT from editor");
        const updatedXSLT = event.data.content;
        
        // Parse the updated XSLT and reload mappings
        try {
          const mappings = xsltParser.parse(updatedXSLT);
          
          // Reconstruct schemas if needed
          const { sourceXSD, targetXSD } = xsltParser.constructSchemasFromMappings(mappings);
          const xsdParser = new XSDParser();
          const sourceSchema = xsdParser.parse(sourceXSD);
          const targetSchema = xsdParser.parse(targetXSD);
          
          // Convert to connections
          const connections = sourceSchema.nodes && targetSchema.nodes && xsltParser.convertToConnections(
            mappings,
            sourceSchema.nodes,
            targetSchema.nodes
          );
          
          // Update state
          setProject((prev) => ({
            ...prev,
            sourceSchema,
            targetSchema,
            connections: connections as IMappingConnection[]
          }));
          
          setGeneratedXSLT(updatedXSLT);
          setOriginalLoadedXSLT(updatedXSLT);
          setShowXSLT(true);
          
          console.log("✅ Mappings reloaded from updated XSLT");
        } catch (error) {
          console.error("❌ Error parsing updated XSLT:", error);
        }
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  //TODO: SOLVE IMPORT XSD TO XSD AND REFERENCE CALLING. HOW TO DO STRUCTURE TO MAKE IT ALL WORK. IS IT POSSIBLE TO CREATE PROJECT WORKSPACE WHERE WILL BE ALL XSDS RELATED AND THEN CONNECT THE IMPORT
  //TODO: FIX THE PREVIEW IN ANOTHER TAB AND CHANGE. DO SOMETHING LIKE PRESAVE AS XSLT THEN UPDATE IT AND THEN ON SAVE REFRESH THE WINDOW WITH IMPORTED AND SHOW CHANGED XSLT MAPPING - WORKS NOW, Better to refactor. Right now saves temp file to extension temp folder
  //TODO: SEARCH FOR APACHE CAMEL CODE AND HOW TO DO THE INTEGRATION FOR THIS MAPPER. 
  //TODO: INVESTIGATE WSDL. IS IT POSSIBLE AND HOW BIG CHANGE IS IT TO INTEGRATE WSDL INTO THE MAPPER
  //TODO: REFACTOR WHOLE CODE STRUCTURE OF GENERATORS AND PARSERS SO IT WILL BE SCALABLE FOR MORE PEOPLE TO WORK ON. ALSO REFACTOR App.tsx to smaller pieces
  // Load empty schemas on mount - user needs to upload XSD files
  useEffect(() => {
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
  }, [])

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

  const handleSaveTransformation = (transformation: IMappingTransformation) => {
    if (!editingConnection) return

    // Transformation changed; do not reuse previously loaded XSLT snapshot.
    setOriginalLoadedXSLT(null)

    const updatedConnection = {
      ...editingConnection,
      transformation,
    }

    // Check if this is a new connection or updating existing
    const existingIndex = project.connections.findIndex((c) => c.id === editingConnection.id)

    if (existingIndex >= 0) {
      // Update existing connection
      setProject((prev) => ({
        ...prev,
        connections: prev.connections.map((c) =>
          c.id === editingConnection.id ? updatedConnection : c
        ),
      }))
    } else {
      // Add new connection
      setProject((prev) => ({
        ...prev,
        connections: [...prev.connections, { ...updatedConnection, type: updatedConnection.transformation?.type || MappingTransformationType.DIRECT }],
      }))
    }

    setSelectedSource(null)
    setSelectedTarget(null)
    setEditingConnection(null)
  }

  const handleEditTransformation = (connection: IMappingConnection) => {
    setEditingConnection(connection)
    setTransformationDialogOpen(true)
  }

  const handleGenerateXSLT = () => {
    if (!project.sourceSchema || !project.targetSchema) {
      alert("Please load both source and target schemas")
      return
    }

    // If we have an original loaded XSLT and connections haven't changed, use the original
    if (originalLoadedXSLT && project.connections.length === xsltMappings.length) {
      // Check if mappings are the same (not modified)
      const mappingsUnchanged = project.connections.every((conn, index) => {
        const originalMapping = xsltMappings[index]
        return originalMapping &&
          conn.sourcePath === originalMapping.sourcePath &&
          conn.targetPath === originalMapping.targetPath
      })

      if (mappingsUnchanged) {
        console.log("Using original loaded XSLT (no changes detected)")
        setGeneratedXSLT(originalLoadedXSLT)
        setShowXSLT(true)
        return
      }
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
  }

  const handleDeleteMapping = (connectionId: string) => {
    setOriginalLoadedXSLT(null) // Mappings changed, clear original
    setProject((prev) => ({
      ...prev,
      connections: prev.connections.filter((c) => c.id !== connectionId),
    }))
  }

  const handleDeleteAllMappings = () => {
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



  const handleOpenXSLTInEditor = () => {
    if (!generatedXSLT) {
      alert("Please generate XSLT first");
      return;
    }

    if (host) {
      host.openXsltInEditor(generatedXSLT);
      return;
    }

    vscode.postMessage({
      type: "openXSLTPreview",
      content: generatedXSLT
    });
  }

  const handleSaveToKaravanActivity = () => {
    if (!host) {
      return;
    }
    let xslt = generatedXSLT;
    if (!xslt && project.sourceSchema && project.targetSchema) {
      xslt = generator.generate(
        project.connections as any,
        project.targetSchema.nodes as any,
        project.sourceSchema.targetNamespace,
        project.targetSchema.targetNamespace,
      );
      setGeneratedXSLT(xslt);
      setShowXSLT(true);
    }
    if (!xslt?.trim()) {
      alert("Generate or load XSLT before saving to the activity.");
      return;
    }
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
  }]
  // Get connection targets map (sourceId -> array of targetIds)
  return (
    <div className={isKaravanEmbedded ? "min-h-full bg-background" : "min-h-screen bg-background"}>
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className={isKaravanEmbedded ? "px-3 py-2" : "container mx-auto px-4 py-4"}>
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="flex flex-col items-center md:items-start">
              <h1 className={isKaravanEmbedded ? "text-lg font-semibold text-foreground" : "text-3xl font-semibold text-foreground"}>{isKaravanEmbedded ? "Karavan Mapper" : "XSLT Mapper"}</h1>
              <p className={isKaravanEmbedded ? "text-sm text-muted-foreground" : "text-base text-muted-foreground"}>
                {isKaravanEmbedded
                  ? "Visual mapping integrated with Camel Karavan activities"
                  : "Visual XSD to XSLT transformation tool"}
              </p>
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
      <div className={isKaravanEmbedded ? "px-3 py-3" : "container mx-auto px-4 py-6"}>
        {/* Tabs for tree view and flow view */}
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="mb-6">
          <TabsList>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))
            }
          </TabsList>

          {/* Tree View Tab */}
          <TabsContent value={ViewMode.Tree} className="mt-6">
            <div ref={treeContainerRef} className="relative !md:overflow-hidden overflow-visible">
              <ConnectionLines
                connections={project.connections}
                containerRef={treeContainerRef}
                getConnectionColor={getConnectionColor}
              />
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 gap-6">
                {/* Source Schema */}
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Source Schema</h2>
                    <Button
                      className="cursor-pointer"
                      size="sm"
                      variant="outline"
                      onClick={() => handleUploadXSD(MappedNodeIDs.Source)}
                    >
                      <LuUpload className="h-4 w-4 mr-2" />
                      Load XSD
                    </Button>
                  </div>
                  <div className="border border-border rounded-md p-2 h-[600px] overflow-auto" ref={leftSchemaListRef}>
                    {project.sourceSchema && project.sourceSchema.nodes ? (
                      <SchemaTree isTreeExpanded={treeExpanded} nodes={project.sourceSchema.nodes} onNodeClick={setSelectedSource} selectedNodeId={selectedSource?.id} side={MappedNodeIDs.Source} onDragStart={handleDragStart} mappedNodeIds={getMappedNodeIds(MappedNodeIDs.Source)} />
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
                <Card className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Target Schema</h2>
                    <Button
                      size="sm"
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => handleUploadXSD(MappedNodeIDs.Target)}
                    >
                      <LuUpload className="h-4 w-4 mr-2" />
                      Load XSD
                    </Button>
                  </div>
                  <div className="border border-border rounded-md p-2 h-[600px] overflow-auto bg-muted/20">
                    {project.targetSchema && project.targetSchema.nodes ? (
                      <SchemaTree
                        isTreeExpanded={treeExpanded}
                        nodes={project.targetSchema.nodes}
                        onNodeClick={setSelectedTarget}
                        selectedNodeId={selectedTarget?.id}
                        side={MappedNodeIDs.Target}
                        onDrop={handleDrop}
                        mappedNodeIds={getMappedNodeIds(MappedNodeIDs.Target)}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        Load a target XSD schema
                      </div>
                    )}
                  </div>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* Flow Diagram Tab */}
          <TabsContent value={ViewMode.Flow} className="mt-6">
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
          </TabsContent>
        </Tabs>

        {/* Mapping Controls */}
        <Card className="mt-6 p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h3 className="font-semibold mb-2">Current Selection</h3>
              <div className="grid grid-cols-2 gap-4 text-base">
                <div>
                  <span className="text-muted-foreground">Source: </span>
                  <span className="font-mono">{selectedSource?.path || "None"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Target: </span>
                  <span className="font-mono">{selectedTarget?.path || "None"}</span>
                </div>
              </div>
            </div>
            <span className="flex flex-row gap-2">
              <Button onClick={handleCreateMapping} disabled={!selectedSource || !selectedTarget} className="cursor-pointer">
                Create Mapping
              </Button>
              <Button onClick={handleDeleteAllMappings} disabled={project.connections.length === 0} variant={ButtonVariant.Outline} className="cursor-pointer">
                <LuTrash2 className="h-4 w-4 mr-2" /> Delete All Mappings
              </Button>
            </span>
          </div>

          <div className="mt-4">
            <h3 className="font-semibold mb-2">Mappings ({project.connections.length})</h3>
            <div className="space-y-1 max-h-32 overflow-auto">
              {project.connections.map((conn) => {
                const color = getConnectionColor(conn.id)
                return (
                  <div
                    key={conn.id}
                    className="text-base font-mono p-2 rounded flex items-center justify-between gap-2 w-full text-start hover:scale-101 duration-300 ease-in-out transition-transform shadow-sm"
                    style={{ backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}
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
                        onClick={() => handleEditTransformation(conn)}
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
                )
              })}
            </div>
          </div>
        </Card>

        {/* XSLT Output */}
        {showXSLT && (
          <Card className="mt-6 p-4 h-full">
            <div className="flex items-center justify-between mb-4">
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
        )}
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
  );
}

export default App;

