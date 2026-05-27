// Parser for XSLT files to extract mappings and visualize them

import type { IMappingConnection, IXSDNode, IXSLTMapping } from "../../types.js";
import { MappingTransformationType, TransformationTypes } from "../../types.js";
export class XSLTParser {
  private namespaceMap: Map<string, string> = new Map();
  private parameters: Set<string> = new Set();
//TODO: FIXNUTÉ NAMESPACES! DONE
//TODO: FIX XSLT GENERATING SOURCE AND TARGET SCHEMAS FINAL XSLT SCHEMA BAD FACTOR
  // Helper method to find elements by local name (namespace-agnostic)
  private getElementsByLocalName(parent: Element | Document, localName: string): Element[] {
    const elements: Element[] = [];
    const allElements = parent.getElementsByTagName('*');
    
    for (let i = 0; i < allElements.length; i++) {
      const element = allElements[i];
      if (element.localName === localName) {
        elements.push(element);
      }
    }
    
    return elements;
  }

  // Extract namespace mappings from XSLT document
  private extractNamespaces(xmlDoc: Document): void {
    this.namespaceMap.clear();
    const root = xmlDoc.documentElement;
    
    // Get all attributes that define namespaces
    for (let i = 0; i < root.attributes.length; i++) {
      const attr = root.attributes[i];
      if (attr.name.startsWith('xmlns:')) {
        const prefix = attr.name.substring(6); // Remove 'xmlns:' prefix
        this.namespaceMap.set(prefix, attr.value);
        console.log(`Namespace mapping: ${prefix} -> ${attr.value}`);
      }
    }
  }

  // Check if a path references an external parameter
  private isParameterReference(path: string): boolean {
    if (!path.startsWith('$')) {return false;}
    
    const paramName = path.split('/')[0].substring(1); // Remove $ and get first part
    return this.parameters.has(paramName);
  }

  // Extract the parameter name from a path like $RenderJSON10/jsonString
  private getParameterName(path: string): string | null {
    if (!path.startsWith('$')) {return null;}
    return path.split('/')[0].substring(1);
  }

  // Detect transformation type from XPath expression
  detectTransformationType(expression: string): MappingTransformationType {
    if (!expression) {
      return MappingTransformationType.DIRECT;
    }

    const trimmed = expression.trim();

    // Check for concat()
    if (trimmed.includes('concat(')) {
      return MappingTransformationType.CONCAT;
    }

    // Check for if-then-else (conditional)
    if (trimmed.includes('if (') && trimmed.includes('then') && trimmed.includes('else')) {
      return MappingTransformationType.CONDITIONAL;
    }

    // Check for common XPath functions
    const functionPatterns = [
      'substring(',
      'substring-before(',
      'substring-after(',
      'string-length(',
      'normalize-space(',
      'translate(',
      'contains(',
      'starts-with(',
      'ends-with(',
      'replace(',
      'tokenize(',
      'format-number(',
      'round(',
      'ceiling(',
      'floor(',
      'sum(',
      'count(',
      'tib:', // TIBCO functions
      'camel:', // Camel functions
      'fn:', // Standard XPath 2.0 functions
    ];

    if (functionPatterns.some(pattern => trimmed.includes(pattern))) {
      return MappingTransformationType.FUNCTION;
    }

    // Check for variable reference (starts with $)
    if (trimmed.startsWith('$') && trimmed.includes('/')) {
      return MappingTransformationType.DIRECT; // Variable path is still direct
    }

    // Simple path like $Start/root/element or just element
    return MappingTransformationType.DIRECT;
  }

  // Construct XSD schemas from extracted mappings
  constructSchemasFromMappings(mappings: IXSLTMapping[]): { sourceXSD: string; targetXSD: string } {
    const sourcePaths = new Set<string>();
    const targetPaths = new Set<string>();
    
    // Extract all unique paths
    mappings.forEach(m => {
      if (m.sourcePath) {sourcePaths.add(m.sourcePath);}
      if (m.targetPath) {targetPaths.add(m.targetPath);}
    });
    
    console.log("Constructing schemas from mappings...");
    console.log("Source paths:", Array.from(sourcePaths));
    console.log("Target paths:", Array.from(targetPaths));
    
    // Build source schema
    const sourceElements = this.buildElementsFromPaths(Array.from(sourcePaths));
    const sourceXSD = this.generateXSDFromElements('SourceSchema', sourceElements);
    
    // Build target schema
    const targetElements = this.buildElementsFromPaths(Array.from(targetPaths));
    const targetXSD = this.generateXSDFromElements('TargetSchema', targetElements);
    
    return { sourceXSD, targetXSD };
  }
  
  // Extract all parameter paths from a complex expression
  private extractPathsFromExpression(expression: string): string[] {
    const paths: string[] = [];
    
    // Find all $paramName/path references (with sub-paths)
    const pathWithSubPathRegex = /\$[\w]+(?:\/[\w\d:]+)+/g;
    const pathMatches = expression.match(pathWithSubPathRegex);
    
    if (pathMatches) {
      paths.push(...pathMatches);
    }
    
    // Also find standalone $paramName references (without sub-paths)
    // This captures $SendHTTPRequest in camel:render-xml($SendHTTPRequest, ...)
    const standaloneParamRegex = /\$[\w]+(?=[,\s)])/g;
    const paramMatches = expression.match(standaloneParamRegex);
    
    if (paramMatches) {
      paths.push(...paramMatches);
    }
    
    if (paths.length > 0) {
      console.log(`Extracted paths from expression: ${paths.join(', ')}`);
    }
    
    return paths;
  }

  // Build nested element structure from flat paths
  private buildElementsFromPaths(paths: string[]): Map<string, any> {
    const structure = new Map<string, any>();
    
    // First pass: extract all real paths from complex expressions
    const allPaths: string[] = [];
    paths.forEach(path => {
      // Check if this is a complex expression (contains concat, camel:, etc)
      if (path.includes('concat(') || path.includes('camel:') || path.includes('normalize-space(')) {
        // Extract all parameter paths from the expression
        const extractedPaths = this.extractPathsFromExpression(path);
        allPaths.push(...extractedPaths);
      } else {
        allPaths.push(path);
      }
    });
    
    // Second pass: build structure from extracted paths
    allPaths.forEach(path => {
      // Skip string literals
      if (path.match(/^["'].*["']$/) || path.startsWith('&quot;')) {
        console.log(`Skipping string literal: ${path}`);
        return;
      }

      // Skip function calls like false(), true()
      if (path.match(/^\w+\(\)$/)) {
        console.log(`Skipping function call: ${path}`);
        return;
      }

      // For parameter references, extract the sub-path after the parameter name
      let cleanPath = path;
      if (this.isParameterReference(path)) {
        const parts = path.split('/');
        if (parts.length > 1) {
          // Remove the $paramName part, keep the rest
          cleanPath = parts.slice(1).join('/');
          console.log(`Extracting sub-path from parameter: ${path} -> ${cleanPath}`);
        } else {
          // Pure parameter reference with no sub-path - create a root element
          const paramName = path.substring(1); // Remove the $
          console.log(`Creating root element for parameter: ${paramName}`);
          if (!structure.has(paramName)) {
            structure.set(paramName, { children: new Map() });
          }
          return;
        }
      }

      // Clean path: remove variables, namespaces, predicates
      cleanPath = cleanPath
        .replace(/^\$[\w]+\//, '')           // Remove $variable/
        .replace(/\/\//g, '/')                // Replace // with /
        .replace(/\w+\d*:/g, '')              // Remove namespace prefixes (tns:, tns1:, etc)
        .replace(/\[@[^\]]+\]/g, '')          // Remove predicates
        .replace(/\[[^\]]+\]/g, '');          // Remove array indices
      
      const parts = cleanPath.split('/').filter(p => p && p !== '.' && p !== '*');
      
      if (parts.length === 0) {
        return; // Skip empty paths
      }
      
      // Build nested structure
      let current = structure;
      parts.forEach((part, index) => {
        if (!current.has(part)) {
          current.set(part, { children: new Map() });
        }
        if (index < parts.length - 1) {
          current = current.get(part).children;
        }
      });
    });
    
    return structure;
  }
  
  // Generate XSD from element structure
  private generateXSDFromElements(rootName: string, elements: Map<string, any>): string {
    const buildSequence = (elementMap: Map<string, any>, indent: string = '        '): string => {
      const lines: string[] = [];
      elementMap.forEach((value, name) => {
        if (value.children.size > 0) {
          lines.push(`${indent}<xs:element name="${name}">`);
          lines.push(`${indent}  <xs:complexType>`);
          lines.push(`${indent}    <xs:sequence>`);
          lines.push(buildSequence(value.children, indent + '      '));
          lines.push(`${indent}    </xs:sequence>`);
          lines.push(`${indent}  </xs:complexType>`);
          lines.push(`${indent}</xs:element>`);
        } else {
          lines.push(`${indent}<xs:element name="${name}" type="xs:string"/>`);
        }
      });
      return lines.join('\n');
    };
    
    if (elements.size === 0) {
      // Empty schema
      return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://example.com/schema"
           elementFormDefault="qualified">
  <xs:element name="${rootName}">
    <xs:complexType>
      <xs:sequence>
        <!-- No elements extracted from XSLT -->
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
    }
    
    const elementsXML = buildSequence(elements);
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://example.com/schema"
           elementFormDefault="qualified">
  <xs:element name="${rootName}">
    <xs:complexType>
      <xs:sequence>
${elementsXML}
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
  }

  parse(xsltContent: string): IXSLTMapping[] {
    console.log("========================================");
    console.log("Parsing XSLT file");
    console.log("XSLT content length:", xsltContent.length);

    if (!xsltContent || xsltContent.trim().length === 0) {
      throw new Error("XSLT file is empty or contains only whitespace");
    }

    const mappings: IXSLTMapping[] = [];
    const parser = new DOMParser();
    
    // Try to parse as XML first
    let xmlDoc: Document;
    try {
      xmlDoc = parser.parseFromString(xsltContent, "application/xml");
    } catch (parseError) {
      console.error("DOMParser error:", parseError);
      throw new Error(`XML parsing failed: ${parseError}`);
    }

    // Check for parsing errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      const errorText = parserError.textContent || "Unknown parsing error";
      console.error("XSLT parsing error:", errorText);
      throw new Error(`Invalid XML/XSLT structure: ${errorText}`);
    }

    // Check if it's actually an XSLT file
    const documentElement = xmlDoc.documentElement;
    if (!documentElement) {
      throw new Error("No root element found in the file");
    }

    const rootTagName = documentElement.tagName.toLowerCase();
    const isXSLT = rootTagName === 'xsl:stylesheet' || 
                   rootTagName === 'xsl:transform' || 
                   documentElement.getAttribute('version') !== null ||
                   documentElement.namespaceURI === 'http://www.w3.org/1999/XSL/Transform';
    
    if (!isXSLT) {
      console.warn("Warning: This doesn't appear to be an XSLT file. Root element:", rootTagName);
      // Don't throw an error, just warn - continue processing
    }

    console.log("Root element:", rootTagName);
    console.log("Namespace URI:", documentElement.namespaceURI);

    // Extract namespace mappings
    this.extractNamespaces(xmlDoc);

    // Find all xsl:param elements using both CSS and local name matching
    const paramElements = this.getUniqueElements(
      Array.from(xmlDoc.querySelectorAll('param')),
      this.getElementsByLocalName(xmlDoc, 'param'),
    );
    console.log("Found", paramElements.length, "xsl:param elements");

    this.parameters.clear();
    paramElements.forEach((element) => {
      const name = element.getAttribute("name");
      if (name) {
        this.parameters.add(name);
        console.log("Parameter:", name);
      }
    });

    // Find all xsl:value-of elements.
    // Both selectors can return the same node; dedupe to avoid duplicate mappings.
    const valueOfElements = this.getUniqueElements(
      Array.from(xmlDoc.querySelectorAll('value-of')),
      this.getElementsByLocalName(xmlDoc, 'value-of'),
    );
    console.log("Found", valueOfElements.length, "xsl:value-of elements");

    valueOfElements.forEach((element, index) => {
      const select = element.getAttribute("select");
      if (select) {
        const trimmedSelect = select.trim();
        
        // Skip if this is a string literal, boolean function, static value, or wildcard
        if (trimmedSelect.match(/^["'].*["']$/) || 
            trimmedSelect.startsWith('&quot;') || 
            trimmedSelect.match(/^(true|false)\(\s*\)$/) ||
            trimmedSelect.match(/^\d+$/) || // Pure numbers
            trimmedSelect === 'true()' ||
            trimmedSelect === 'false()' ||
            trimmedSelect.includes('/*') || // Wildcards like /*
            trimmedSelect.match(/\*\[\d+\]/)) { // Positional like *[1]
          console.log(`Skipping literal/function/wildcard value: ${select}`);
          return;
        }

        const targetPath = this.getTargetPath(element);
        const isConditional = this.isInsideConditional(element);
        const condition = isConditional ? this.getCondition(element) : undefined;

        // Check if source is a parameter reference
        const paramName = this.getParameterName(select);
        if (paramName) {
          console.log(`Source references external parameter: $${paramName}`);
        }

        mappings.push({
          sourcePath: select,
          targetPath: targetPath || `output/field${index + 1}`,
          transformationType: TransformationTypes.VALUE_OF,
          expression: select,
          isConditional,
          condition,
        });

        console.log(`Mapping ${index + 1}:`, {
          source: select,
          target: targetPath,
          type: "value-of",
          conditional: isConditional,
          condition,
          isParameterRef: !!paramName,
        });
      }
    });

    // Find all xsl:copy-of elements
    const copyOfElements = this.getUniqueElements(
      Array.from(xmlDoc.querySelectorAll('copy-of')),
      this.getElementsByLocalName(xmlDoc, 'copy-of'),
    );
    console.log("Found", copyOfElements.length, "xsl:copy-of elements");
    console.log("Skipping all xsl:copy-of elements - not supported in visual mapper (TIBCO-style behavior)");
    
    // TIBCO does not visualize copy-of operations - they copy entire structures
    // Only value-of (individual field mappings) can be visualized
    // So we skip all copy-of elements

    // Find all xsl:template elements
    const templateElements = this.getUniqueElements(
      Array.from(xmlDoc.querySelectorAll('template')),
      this.getElementsByLocalName(xmlDoc, 'template'),
    );
    console.log("Found", templateElements.length, "xsl:template elements");
    console.log("Skipping template matches - they define structure, not field mappings (TIBCO-style behavior)");
    
    // TIBCO does not visualize template matches - only the value-of statements inside templates
    // Templates are structural containers, not field mappings

    console.log("Total mappings extracted:", mappings.length);
    console.log("========================================");

    return mappings;
  }

  private getUniqueElements(...groups: Element[][]): Element[] {
    const seen = new Set<Element>();
    const result: Element[] = [];
    for (const group of groups) {
      for (const element of group) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        result.push(element);
      }
    }
    return result;
  }

  private isInsideConditional(element: Element): boolean {
    let current: Element | null = element.parentElement;
    while (current) {
      if (current.localName === "if" || current.tagName.toLowerCase().includes("if")) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  private getCondition(element: Element): string | undefined {
    let current: Element | null = element.parentElement;
    while (current) {
      if (current.localName === "if" || current.tagName.toLowerCase().includes("if")) {
        return current.getAttribute("test") || undefined;
      }
      current = current.parentElement;
    }
    return undefined;
  }

  private getTargetPath(element: Element): string {
    let current: Element | null = element.parentElement;
    const pathParts: string[] = [];
    const namespaceInfo: string[] = [];

    while (current) {
      const localName = current.localName;
      const tagName = current.tagName;

      // Look for element creation tags
      if (localName === "element") {
        const name = current.getAttribute("name");
        if (name) {
          pathParts.unshift(name);
        }
      } else if (localName === "attribute") {
        const name = current.getAttribute("name");
        if (name) {
          pathParts.unshift(`@${name}`);
        }
      } else if (
        !localName?.startsWith("xsl:") &&
        localName !== "stylesheet" &&
        localName !== "transform" &&
        localName !== "template"
      ) {
        // Regular XML element (not XSL instruction)
        // Preserve namespace prefix info for debugging but use clean name in path
        if (tagName.includes(":")) {
          const [prefix, name] = tagName.split(":");
          const namespace = this.namespaceMap.get(prefix);
          if (namespace) {
            namespaceInfo.unshift(`${name} (${prefix})`);
          }
          pathParts.unshift(name);
        } else {
          pathParts.unshift(tagName);
        }
      }

      current = current.parentElement;
    }

    const path = pathParts.length > 0 ? pathParts.join("/") : "";
    if (namespaceInfo.length > 0) {
      console.log(`Target path with namespaces: ${namespaceInfo.join('/')} -> ${path}`);
    }
    return path;
  }

  convertToConnections(mappings: IXSLTMapping[], sourceNodes: IXSDNode[], targetNodes: IXSDNode[]): IMappingConnection[] {
    console.log(" ========================================");
    console.log(" Converting XSLT mappings to connections");
    console.log(" Number of mappings:", mappings.length);
    console.log(" Source nodes:", sourceNodes.length);
    console.log(" Target nodes:", targetNodes.length);
    
    // Log all available source and target node IDs for debugging
    const logNodes = (nodes: IXSDNode[], prefix: string = '') => {
      nodes.forEach(node => {
        console.log(` ${prefix}Node: ${node.id} -> ${node.path}`);
        if (node.children) {
          logNodes(node.children, prefix + '  ');
        }
      });
    };
    
    console.log(" Available source nodes:");
    logNodes(sourceNodes);
    console.log(" Available target nodes:");
    logNodes(targetNodes);

    const connections: IMappingConnection[] = [];

    mappings.forEach((mapping, index) => {
      console.log(` --- Mapping ${index + 1} ---`);
      console.log(` Source path: "${mapping.sourcePath}"`);
      console.log(` Target path: "${mapping.targetPath}"`);
      
      // Try to find matching nodes in the schemas
      const sourceNode = this.findNodeByPath(sourceNodes, mapping.sourcePath);
      const targetNode = this.findNodeByPath(targetNodes, mapping.targetPath);

      if (!sourceNode) {
        console.warn(` ⚠️ No source node found for path: "${mapping.sourcePath}"`);
      } else {
        console.log(` ✓ Found source node: ${sourceNode.id}`);
      }
      
      if (!targetNode) {
        console.warn(` ⚠️ No target node found for path: "${mapping.targetPath}"`);
      } else {
        console.log(` ✓ Found target node: ${targetNode.id}`);
      }

      // Detect transformation type from the expression
      const transformationType = this.detectTransformationType(mapping.expression || mapping.sourcePath);
      console.log(` Detected transformation type: ${transformationType}`);

      const connection: IMappingConnection = {
        id: `xslt-conn-${index}`,
        sourceId: sourceNode?.id || `source-${index}`,
        targetId: targetNode?.id || `target-${index}`,
        sourcePath: mapping.sourcePath,
        targetPath: mapping.targetPath,
        type: transformationType,
        transformation: mapping.expression ? {
          type: transformationType,
          customXPath: mapping.expression
        } : undefined
      };

      connections.push(connection);
      console.log(` Created connection:`, connection);
    });

    console.log(" ========================================");
    console.log(" Total connections created:", connections.length);
    const validConnections = connections.filter(c => 
      !c.sourceId.startsWith('source-') && !c.targetId.startsWith('target-')
    );
    console.log(" Valid connections (both nodes found):", validConnections.length);
    console.log(" ========================================");
    
    return connections;
  }

  private findNodeByPath(nodes: IXSDNode[], path: string): IXSDNode | null {
    let extractedPath = path;
    
    if (extractedPath.includes('concat(')) {
      const concatContent = extractedPath.match(/concat\s*\((.*)\)/s);
      if (concatContent) {
        const allArgs = concatContent[1];
        const paramMatch = allArgs.match(/\$[_\w]+/);
        if (paramMatch) {
          extractedPath = paramMatch[0];
          console.log(`Extracted parameter from concat: "${path}" -> "${extractedPath}"`);
        } else {
          console.log(`concat() with no parameter references - no node path`);
          return null;
        }
      }
    }
    
    // Look for patterns: functionName($path, ...) or functionName($path)
    if (!this.isParameterReference(extractedPath)) {
      const functionMatch = extractedPath.match(/[\w-]+:[\w-]+\((\$[_\w]+[^,)]*)/);
      if (functionMatch) {
        extractedPath = functionMatch[1];
        console.log(`Extracted path from function: "${path}" -> "${extractedPath}"`);
      }
    }
    
    if (this.isParameterReference(extractedPath)) {
      const paramName = this.getParameterName(extractedPath);
      console.log(`Path references external parameter: $${paramName}`);
      // For parameter references, try to match the sub-path after the parameter
      const pathAfterParam = extractedPath.split('/').slice(1).join('/');
      if (pathAfterParam) {
        extractedPath = pathAfterParam;
        console.log(`Extracted sub-path from parameter: "${extractedPath}"`);
      } else {
        // Pure parameter reference with no sub-path - try to match the parameter name itself
        const cleanParamName = extractedPath.replace('$', '');
        console.log(`Pure parameter reference - trying to match parameter name: "${cleanParamName}"`);
        
        // Look for a node with the parameter name
        for (const node of nodes) {
          if (node.name === cleanParamName) {
            console.log(`Found node for parameter: ${node.id} (${node.path})`);
            return node;
          }
          // Also search in children
          if (node.children && node.children.length > 0) {
            const findByName = (children: IXSDNode[]): IXSDNode | null => {
              for (const child of children) {
                if (child.name === cleanParamName) {
                  return child;
                }
                if (child.children && child.children.length > 0) {
                  const found = findByName(child.children);
                  if (found) {return found;}
                }
              }
              return null;
            };
            const found = findByName(node.children);
            if (found) {
              console.log(`Found node for parameter in children: ${found.id} (${found.path})`);
              return found;
            }
          }
        }
        
        console.log(`No matching node found for parameter: ${cleanParamName}`);
        return null;
      }
    }

    // Handle other XPath 
    const xpathFunctionMatch = extractedPath.match(/(?:substring|normalize-space|string)\s*\(([^,)]+)/);
    if (xpathFunctionMatch) {
      extractedPath = xpathFunctionMatch[1].trim().replace(/['"]/g, '');
      console.log(`Extracted path from XPath function: "${path}" -> "${extractedPath}"`);
    }
    
    // Clean the XSLT path: remove $variables, namespaces, predicates, slashes
    let cleanPath = extractedPath
      .replace(/^\$[_\w]+\//, '')           // Remove $variable/
      .replace(/^\/+/, '')                  // Remove leading slashes
      .replace(/\w+\d*:/g, '')              // Remove namespace prefixes like tns:, tns1:, tns2:
      .replace(/\[@[^\]]+\]/g, '')          // Remove predicates like [@attr='value']
      .replace(/\[[^\]]+\]/g, '')           // Remove array indices like [1]
      .replace(/\/\*$/g, '')                // Remove trailing wildcard like parameters/*
      .replace(/^\*$/g, '');                // Remove standalone wildcard

    console.log(`Finding node for path: "${path}" -> cleaned: "${cleanPath}"`);

  //TODO:DELETE ALL TIBCO WORD IN APP FRONTEND
  //TODO:CHECK XSLT NAMESPACES AND THEIR DISPLAYING LIKE IN TIBCO 
  //TODO: CHANGE VIEWER XSLT TO EDITOR AND REFRESH AND APPLY NEW ON SAVE 

     // Skip if cleaned path is empty or just a literal
    if (!cleanPath || cleanPath.match(/^["'].*["']$/)) {
      console.log(`Path is empty or literal after cleaning - no node to match`);
      return null;
    }


    // Try exact path match first (strip namespaces from node path for comparison)
    for (const node of nodes) {
      const nodePath = node.path.replace(/^\/+/, '').replace(/\w+\d*:/g, ''); // Strip namespaces
      if (nodePath === cleanPath || nodePath.endsWith('/' + cleanPath)) {
        console.log(`Exact match found: ${node.id} (${node.path})`);
        return node;
      }
    }

    // Try partial path match (for nested structures)
    const pathParts = cleanPath.split('/').filter(p => p);
    
    const findRecursive = (currentNodes: IXSDNode[], remainingParts: string[]): IXSDNode | null => {
      if (remainingParts.length === 0) {return null;}
      
      const targetName = remainingParts[remainingParts.length - 1];
      
      for (const node of currentNodes) {
        // Check if this node's name matches the target
        if (node.name === targetName) {
          // Verify the full path matches by comparing all parts (strip namespaces)
          const nodePathParts = node.path.split('/').filter(p => p).map(p => p.replace(/\w+\d*:/, ''));
          const matches = pathParts.every((part, idx) => {
            const nodePartIdx = nodePathParts.length - pathParts.length + idx;
            return nodePartIdx >= 0 && nodePathParts[nodePartIdx] === part;
          });
          
          if (matches) {
            console.log(`Recursive match found: ${node.id} (${node.path})`);
            return node;
          }
        }
        
        // Search in children
        if (node.children && node.children.length > 0) {
          const found = findRecursive(node.children, remainingParts);
          if (found) {return found;}
        }
      }
      
      return null;
    };

    const result = findRecursive(nodes, pathParts);
    if (!result) {
      console.log(`No match found for path: "${cleanPath}"`);
    }
    return result;
  }
}
