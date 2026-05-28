import { MappingTransformationType, type IXSDNode } from "../../../types.js";


export class XSLTGenerator {
  private variables: Map<string, string> = new Map();
  
  private isPseudoSegment(segment: string): boolean {
    return /^\[.*\]$/.test(segment.trim());
  }

  private sanitizeXmlName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed || this.isPseudoSegment(trimmed)) {
      return "";
    }
    const cleaned = trimmed
      .replace(/\s+/g, "_")
      .replace(/[^A-Za-z0-9_.:-]/g, "_");
    if (!cleaned) {
      return "";
    }
    if (/^[0-9.-]/.test(cleaned)) {
      return `n_${cleaned}`;
    }
    return cleaned;
  }

  private normalizePath(path: string): string {
    return path
      .split("/")
      .map(part => part.trim())
      .filter(part => part.length > 0 && !this.isPseudoSegment(part))
      .join("/");
  }

  private resolveTargetElementName(node: IXSDNode): string {
    const pathParts = node.path.split("/").filter(Boolean);
    const pathLeaf = pathParts.length > 0 ? pathParts[pathParts.length - 1] : "";
    const fromPath = this.sanitizeXmlName(pathLeaf);
    if (fromPath) {
      return fromPath;
    }
    return this.sanitizeXmlName(node.name);
  }

  generate(
    connections: any[],
    targetNodes: IXSDNode[],
    sourceNamespace?: string,
    targetNamespace?: string,
    additionalNamespaces?: Record<string, string>,
  ): string {
    this.variables.clear();
    
    // Collect all namespaces
    const namespaces = this.buildNamespaceDeclarations(additionalNamespaces);
    
    const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" 
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                ${sourceNamespace ? `xmlns:src="${sourceNamespace}"` : ""}
                ${targetNamespace ? `xmlns:tgt="${targetNamespace}"` : ""}
                ${namespaces}>
  
  <xsl:output method="xml" indent="yes"/>
  
  <xsl:template match="/">
${this.generateVariables(connections, 2)}
    ${this.generateMappings(connections, targetNodes)}
  </xsl:template>
  
</xsl:stylesheet>`;

    return xslt;
  }

  private buildNamespaceDeclarations(additionalNamespaces?: Record<string, string>): string {
    if (!additionalNamespaces) {return "";}
    
    return Object.entries(additionalNamespaces)
      .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
      .join("\n                ");
  }

  private generateVariables(connections: any[], indentLevel: number): string {
    const indent = "  ".repeat(indentLevel);
    let result = "";
    
    connections.forEach(conn => {
      if (conn.transformation?.type === 'variable' && conn.transformation.variableName) {
        result += `${indent}<xsl:variable name="${conn.transformation.variableName}" select="${conn.transformation.variableExpression}"/>\n`;
      }
    });
    
    return result;
  }

  private generateMappings(connections: any[], targetNodes: IXSDNode[]): string {
    // Group connections by target path to build nested structure
    const mappingsByTarget = new Map<string, any[]>();

    connections.forEach((conn) => {
      const normalizedTargetPath = this.normalizePath(conn.targetPath ?? "");
      const existing = mappingsByTarget.get(normalizedTargetPath) || [];
      existing.push(conn);
      mappingsByTarget.set(normalizedTargetPath, existing);
    });

    // Build from the first real target node (skip wrapper nodes like "TargetSchema")
    // If there's only one root node and it's a wrapper, start from its children
    if (targetNodes.length === 1 && targetNodes[0].children && targetNodes[0].children.length > 0) {
      // Skip the wrapper and start from actual target structure
      return this.buildTargetStructure(targetNodes[0].children, mappingsByTarget, 2, true);
    }
    
    return this.buildTargetStructure(targetNodes, mappingsByTarget, 2, true);
  }

  private buildTargetStructure(
    nodes: IXSDNode[],
    mappings: Map<string, any[]>,
    indentLevel: number,
    _isRoot: boolean = false,
  ): string {
    const indent = "  ".repeat(indentLevel);
    let result = "";

    nodes.forEach((node) => {
      const elementName = this.resolveTargetElementName(node);
      const normalizedNodePath = this.normalizePath(node.path);
      const nodeLeaf = normalizedNodePath.split("/").filter(Boolean).pop() ?? "";
      const connections = mappings.get(normalizedNodePath) || mappings.get(nodeLeaf);

      if (connections && connections.length > 0) {
        // This node has a mapping
        const conn = connections[0];
        
        // Check if this mapping has a condition
        if (conn.transformation?.type === 'conditional') {
          result += this.generateConditionalMapping(conn, elementName, indent);
        } else {
          result += this.generateSimpleMapping(conn, elementName, indent);
        }
      } else if (node.children && node.children.length > 0) {
        // This node has children, recurse
        if (elementName) {
          result += `${indent}<${elementName}>\n`;
          result += this.buildTargetStructure(node.children, mappings, indentLevel + 1, false);
          result += `${indent}</${elementName}>\n`;
        } else {
          result += this.buildTargetStructure(node.children, mappings, indentLevel, false);
        }
      }
    });

    return result;
  }

  private generateSimpleMapping(conn: any, targetElementName: string, indent: string): string {
    if (!targetElementName) {
      return "";
    }
    const transformation = conn.transformation;
    const fallbackExpression = (conn.sourcePath ?? "").trim();
    let result = `${indent}<${targetElementName}>\n`;
    
    if (!transformation || transformation.type === MappingTransformationType.DIRECT) {
      // Simple direct mapping
      result += `${indent}  <xsl:value-of select="${this.normalizePath(fallbackExpression)}"/>\n`;
    } else if (transformation.type === MappingTransformationType.CONCAT && transformation.parts) {
      // Concatenation
      result += `${indent}  <xsl:value-of select="concat(${this.buildConcatArgs(transformation.parts)})"/>\n`;
    } else if (transformation.type === MappingTransformationType.CONCAT && transformation.customXPath) {
      // Concatenation entered as raw XPath expression
      result += `${indent}  <xsl:value-of select="${transformation.customXPath}"/>\n`;
    } else if (transformation.type === MappingTransformationType.FUNCTION && transformation.customXPath) {
      // Custom function or XPath
      result += `${indent}  <xsl:value-of select="${transformation.customXPath}"/>\n`;
    } else if (transformation.type === MappingTransformationType.VARIABLE && transformation.variableName) {
      // Use a variable
      result += `${indent}  <xsl:value-of select="$${transformation.variableName}"/>\n`;
    } else if (fallbackExpression) {
      // Keep mapping renderable even when transformation payload is partial.
      result += `${indent}  <xsl:value-of select="${this.normalizePath(fallbackExpression)}"/>\n`;
    }
    
    result += `${indent}</${targetElementName}>\n`;
    return result;
  }

  private generateConditionalMapping(conn: any, targetElementName: string, indent: string): string {
    const transformation = conn.transformation;
    if (!transformation || !transformation.condition || !targetElementName) {return "";}
    
    let result = `${indent}<xsl:if test="${transformation.condition}">\n`;
    result += `${indent}  <${targetElementName}>\n`;
    
    if (transformation.thenValue) {
      result += `${indent}    <xsl:value-of select="${transformation.thenValue}"/>\n`;
    }
    
    result += `${indent}  </${targetElementName}>\n`;
    result += `${indent}</xsl:if>\n`;
    
    return result;
  }

  private buildConcatArgs(parts: Array<{ type: 'literal' | 'xpath'; value: string }>): string {
    return parts.map(part => {
      if (part.type === 'literal') {
        return `'${part.value}'`;
      } else {
        return part.value;
      }
    }).join(', ');
  }

  /**
   * Generate advanced XSLT with TIBCO-style transformations (100% compatible)
   */
  generateAdvanced(
    rootElement: string,
    mappings: Array<{
      targetPath: string
      sourcePath?: string
      transformation?: {
        type: 'direct' | 'concat' | 'conditional' | 'variable' | 'function' | 'inline-variable' | 'nested-variable'
        expression?: string
        condition?: string
        variableName?: string
        variableExpression?: string
        variablePosition?: 'before' | 'inline' | 'after'
        // For nested structures like amount/value with inline variable
        nestedStructure?: {
          outerElement: string
          innerElement: string
          variableName: string
          variableExpression: string
          valueExpression: string
        }
        // For inline variables that appear AFTER their usage
        inlineVariables?: Array<{
          name: string
          expression: string
          position: 'before' | 'after'
        }>
      }
      isOptional?: boolean
      skipElement?: boolean // Skip element tag, just generate content
    }>,
    namespaces?: Record<string, string>,
  ): string {
    const ns = this.buildNamespaceDeclarations(namespaces);
    
    let result = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" 
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                ${ns}>
  
  <xsl:output method="xml" indent="yes"/>
  
  <xsl:template match="/">
`;
    
    result += `<${rootElement}>\n`;
    
    // Generate mappings with TIBCO-style inline variables
    mappings.forEach(m => {
      const pathParts = m.targetPath.split('/');
      const elementName = pathParts[pathParts.length - 1];
    //   const parentElement = pathParts.length > 2 ? pathParts[pathParts.length - 2] : null;
      
      const t = m.transformation;
      
      // Handle nested structure with inline variable (like amount/value)
      if (t?.type === 'nested-variable' && t.nestedStructure) {
        const ns = t.nestedStructure;
        result += `<${ns.outerElement}>\n`;
        result += `<xsl:variable name="${ns.variableName}" select="${ns.variableExpression}"/>\n`;
        result += `<${ns.innerElement}>\n`;
        result += `<xsl:value-of select="${ns.valueExpression}"/>\n`;
        result += `</${ns.innerElement}>\n`;
        result += `</${ns.outerElement}>\n`;
        return;
      }
      
      // Handle conditional with optional element
      if (m.isOptional && t?.condition) {
        result += `<xsl:if test="${t.condition}">\n`;
        
        // Check if we need inline variable BEFORE the element
        if (t.inlineVariables && t.inlineVariables.some(v => v.position === 'before')) {
          t.inlineVariables.filter(v => v.position === 'before').forEach(v => {
            result += `<xsl:variable name="${v.name}" select="${v.expression}"/>\n`;
          });
        }
        
        result += `<${elementName}>\n`;
        result += `<xsl:value-of select="${t.expression || m.sourcePath}"/>\n`;
        result += `</${elementName}>\n`;
        
        // Check if we need inline variable AFTER the element
        if (t.inlineVariables && t.inlineVariables.some(v => v.position === 'after')) {
          t.inlineVariables.filter(v => v.position === 'after').forEach(v => {
            result += `<xsl:variable name="${v.name}" select="${v.expression}"/>\n`;
          });
        }
        
        result += `</xsl:if>\n`;
        return;
      }
      
      // Handle variable that should be declared inline (TIBCO style)
      if (t?.type === 'inline-variable' && t.variableName && t.variableExpression) {
        // Variable appears AFTER the element that uses it (TIBCO style)
        result += `<${elementName}>\n`;
        result += `<xsl:value-of select="$${t.variableName}"/>\n`;
        result += `</${elementName}>\n`;
        result += `<xsl:variable name="${t.variableName}" select="${t.variableExpression}"/>\n`;
        return;
      }
      
      // Handle regular variable (declared before use)
      if (t?.type === 'variable' && t.variableName && t.variableExpression) {
        if (t.variablePosition === 'inline' || t.variablePosition === 'before') {
          result += `<xsl:variable name="${t.variableName}" select="${t.variableExpression}"/>\n`;
        }
        result += `<${elementName}>\n`;
        result += `<xsl:value-of select="$${t.variableName}"/>\n`;
        result += `</${elementName}>\n`;
        if (t.variablePosition === 'after') {
          result += `<xsl:variable name="${t.variableName}" select="${t.variableExpression}"/>\n`;
        }
        return;
      }
      
      // Handle standard element with expression
      if (!m.skipElement) {
        result += `<${elementName}>\n`;
      }
      
      result += `<xsl:value-of select="${t?.expression || m.sourcePath}"/>\n`;
      
      if (!m.skipElement) {
        result += `</${elementName}>\n`;
      }
    });
    
    result += `</${rootElement}>\n`;
    result += `  </xsl:template>\n`;
    result += `  \n`;
    result += `</xsl:stylesheet>`;
    
    return result;
  }

  /**
   * Generate TIBCO Logger Pattern XSLT
   * Used for logging/filtering responses with @xsi:nil handling and conditional elements
   */
  generateTibcoLogger(
    rootElement: string,
    mappings: Array<{
      sourcePath: string
      targetPath: string
      isOptional?: boolean // minOccurs="0"
      transformation?: {
        type: 'tibco-logger'
        sourceVariable?: string
        copyNilAttributes?: boolean
        addConditionalWrapper?: boolean
        hardcodedValue?: string
      }
    }>,
    namespaces: Record<string, string>
  ): string {
    const sourceVar = mappings[0]?.transformation?.sourceVariable || 'Start';
    
    // Build namespace declarations
    let nsDeclarations = 'xmlns:xsl="http://www.w3.org/1999/XSL/Transform"\n';
    nsDeclarations += '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    Object.entries(namespaces).forEach(([prefix, uri]) => {
      nsDeclarations += `  xmlns:${prefix}="${uri}"\n`;
    });
    
    let result = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    result += `<${rootElement} ${nsDeclarations}>\n`;
    
    mappings.forEach(m => {
      const pathParts = m.targetPath.split('/');
      const elementName = pathParts[pathParts.length - 1];
      const t = m.transformation;
      
      if (!t || t.type !== 'tibco-logger') {
        // Fallback to simple mapping
        result += `  <${elementName}>\n`;
        result += `    <xsl:value-of select="$${sourceVar}/${m.sourcePath}"/>\n`;
        result += `  </${elementName}>\n`;
        return;
      }
      
      // Build source XPath
      const sourceXPath = `$${sourceVar}/${m.sourcePath}`;
      
      // Handle hardcoded values
      if (t.hardcodedValue) {
        result += `  <${elementName}>${t.hardcodedValue}</${elementName}>\n`;
        return;
      }
      
      // Handle optional elements with conditional wrapper
      if (m.isOptional && t.addConditionalWrapper) {
        result += `  <xsl:if test="${sourceXPath}">\n`;
        result += `    <${elementName}>\n`;
        
        // Copy @xsi:nil attribute
        if (t.copyNilAttributes) {
          result += `      <xsl:copy-of select="${sourceXPath}/@xsi:nil"/>\n`;
        }
        
        result += `      <xsl:value-of select="${sourceXPath}"/>\n`;
        result += `    </${elementName}>\n`;
        result += `  </xsl:if>\n`;
      } else {
        // Required element
        result += `  <${elementName}>\n`;
        
        // Copy @xsi:nil attribute
        if (t.copyNilAttributes) {
          result += `    <xsl:copy-of select="${sourceXPath}/@xsi:nil"/>\n`;
        }
        
        result += `    <xsl:value-of select="${sourceXPath}"/>\n`;
        result += `  </${elementName}>\n`;
      }
    });
    
    result += `</${rootElement}>`;
    
    return result;
  }
}
