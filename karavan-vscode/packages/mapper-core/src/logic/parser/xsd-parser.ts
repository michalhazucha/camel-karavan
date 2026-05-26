import type { IXSDNode, IXSDSchema } from "../../types.js";

export class XSDParser {
  private nodeIdCounter = 0;
  private schemaElement: Element | null = null;
  private namespaceMap: Map<string, string> = new Map();

  // Strip namespace prefix from element name for display (like TIBCO)
  private stripNamespacePrefix(name: string): string {
    // Remove namespace prefix (e.g., "tns:element" -> "element")
    return name.replace(/^\w+:/, '');
  }

  parse(xsdContent: string): IXSDSchema {
    console.log("XSDParser: Starting parse...");

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xsdContent, "text/xml");

    // Check for parsing errors
    const parserError = xmlDoc.querySelector("parsererror");
    if (parserError) {
      console.error("XSDParser: Parse error detected:", parserError.textContent);
      throw new Error("Invalid XSD: " + parserError.textContent);
    }

    this.schemaElement = xmlDoc.documentElement;
    console.log("XSDParser: Root element name:", this.schemaElement.nodeName);

    if (
      this.schemaElement.nodeName !== "xs:schema" &&
      this.schemaElement.nodeName !== "xsd:schema" &&
      this.schemaElement.nodeName !== "schema"
    ) {
      throw new Error("Root element must be xs:schema or xsd:schema");
    }

    // Build namespace map
    this.buildNamespaceMap(this.schemaElement);

    const targetNamespace = this.schemaElement.getAttribute("targetNamespace") || undefined;
    const elementFormDefault = this.schemaElement.getAttribute("elementFormDefault") || undefined;

    console.log("XSDParser: Target namespace:", targetNamespace);
    console.log("XSDParser: Element form default:", elementFormDefault);
    console.log("XSDParser: Namespace map:", Array.from(this.namespaceMap.entries()));

    const nodes = this.parseElements(this.schemaElement, "");
    console.log("XSDParser: Parsed", nodes.length, "root elements");

    return {
      targetNamespace,
      elementFormDefault,
      nodes,
    };
  }

  private buildNamespaceMap(element: Element): void {
    // Get all namespace declarations
    Array.from(element.attributes).forEach((attr) => {
      if (attr.name.startsWith("xmlns:")) {
        const prefix = attr.name.substring(6);
        this.namespaceMap.set(prefix, attr.value);
        console.log(`XSDParser: Found namespace prefix "${prefix}" -> "${attr.value}"`);
      }
    });
  }

  private parseElements(parentElement: Element, parentPath: string): IXSDNode[] {
    const nodes: IXSDNode[] = [];
    const elements = parentElement.querySelectorAll(":scope > xs\\:element, :scope > xsd\\:element, :scope > element");
    console.log(`XSDParser: Found ${elements.length} elements at path "${parentPath}"`);

    elements.forEach((element) => {
      const node = this.parseElement(element as Element, parentPath);
      if (node) {
        console.log(`XSDParser: Parsed element "${node.name}" with ${node.children?.length || 0} children`);
        nodes.push(node);
      }
    });

    // If no elements found at root level, parse complexTypes as root nodes
    if (parentPath === "" && nodes.length === 0) {
      console.log("XSDParser: No root elements found, parsing complexTypes...");
      const complexTypes = parentElement.querySelectorAll(":scope > xs\\:complexType, :scope > xsd\\:complexType, :scope > complexType");
      console.log(`XSDParser: Found ${complexTypes.length} complexTypes`);
      
      complexTypes.forEach((complexType) => {
        const node = this.parseComplexTypeAsElement(complexType as Element, parentPath);
        if (node) {
          console.log(`XSDParser: Parsed complexType "${node.name}" with ${node.children?.length || 0} children`);
          nodes.push(node);
        }
      });
    }

    return nodes;
  }

  private parseComplexTypeAsElement(complexType: Element, parentPath: string): IXSDNode | null {
    const fullName = complexType.getAttribute("name");
    if (!fullName) {
      return null;
    }

    // Keep full namespaced path for XPath
    const path = parentPath ? `${parentPath}/${fullName}` : fullName;
    // But display name without namespace prefix (TIBCO style)
    const displayName = this.stripNamespacePrefix(fullName);
    const nodeId = `node-${this.nodeIdCounter++}`;

    // Parse sequence/all/choice within complexType
    const children: IXSDNode[] = [];
    const sequence = complexType.querySelector(":scope > xs\\:sequence, :scope > xsd\\:sequence, :scope > sequence");
    const all = complexType.querySelector(":scope > xs\\:all, :scope > xsd\\:all, :scope > all");
    const choice = complexType.querySelector(":scope > xs\\:choice, :scope > xsd\\:choice, :scope > choice");

    const container = sequence || all || choice;
    if (container) {
      const childElements = container.querySelectorAll(":scope > xs\\:element, :scope > xsd\\:element, :scope > element");
      childElements.forEach((childElement) => {
        const childNode = this.parseElement(childElement as Element, path);
        if (childNode) {
          children.push(childNode);
        }
      });
    }

    // Try to extract namespace from targetNamespace if available
    const namespaceURI = this.schemaElement?.getAttribute("targetNamespace") || undefined;

    return {
      id: nodeId,
      name: displayName,
      type: "complexType",
      path,
      namespace: namespaceURI,
      children: children.length > 0 ? children : undefined,
    };
  }

  private parseElement(element: Element, parentPath: string): IXSDNode | null {
    const fullName = element.getAttribute("name");
    if (!fullName) {return null;}

    const typeAttr = element.getAttribute("type") || "string";
    // Keep full namespaced path for XPath
    const path = parentPath ? `${parentPath}/${fullName}` : fullName;
    // But display name without namespace prefix (TIBCO style)
    const displayName = this.stripNamespacePrefix(fullName);
    const id = `node-${this.nodeIdCounter++}`;

    // Extract namespace from type if it has a prefix (e.g., "tns:MessageBodyType")
    const typePrefix = typeAttr.includes(':') ? typeAttr.split(':')[0] : null;
    const namespaceURI = typePrefix ? this.namespaceMap.get(typePrefix) : undefined;

    const node: IXSDNode = {
      id,
      name: displayName,
      type: typeAttr,
      path,
      namespace: namespaceURI,
      children: [],
      attributes: [],
      isExpanded: false,
    };

    // Parse complex type children
    const complexType = element.querySelector(
      ":scope > xs\\:complexType, :scope > xsd\\:complexType, :scope > complexType",
    );
    if (complexType) {
      this.parseComplexType(complexType, node, path);
    }

    // If element has a type reference, try to resolve it
    const typeRef = element.getAttribute("type");
    if (typeRef && !complexType) {
      this.resolveTypeReference(typeRef, node, path);
    }

    return node;
  }

  private parseComplexType(complexType: Element, node: IXSDNode, path: string): void {
    // Check for complexContent with extension
    const complexContent = complexType.querySelector(
      ":scope > xs\\:complexContent, :scope > xsd\\:complexContent, :scope > complexContent",
    );

    if (complexContent) {
      const extension = complexContent.querySelector(
        ":scope > xs\\:extension, :scope > xsd\\:extension, :scope > extension",
      );

      if (extension) {
        const baseType = extension.getAttribute("base");
        console.log(`XSDParser: Found extension base="${baseType}" for element "${node.name}"`);

        // Resolve base type first
        if (baseType) {
          this.resolveTypeReference(baseType, node, path);
        }

        // Then parse additional elements from the extension
        const sequence = extension.querySelector(":scope > xs\\:sequence, :scope > xsd\\:sequence, :scope > sequence");
        if (sequence) {
          const additionalChildren = this.parseElements(sequence, path);
          node.children = [...(node.children || []), ...additionalChildren];
        }

        // Parse attributes from extension
        this.parseAttributes(extension, node);
      }
    } else {
      // Regular complexType without extension
      const sequence = complexType.querySelector(":scope > xs\\:sequence, :scope > xsd\\:sequence, :scope > sequence");
      if (sequence) {
        node.children = this.parseElements(sequence, path);
      }

      // Parse attributes
      this.parseAttributes(complexType, node);
    }
  }

  private parseAttributes(element: Element, node: IXSDNode): void {
    const attributes = element.querySelectorAll(
      ":scope > xs\\:attribute, :scope > xsd\\:attribute, :scope > attribute",
    );
    attributes.forEach((attr) => {
      const attrName = attr.getAttribute("name");
      const attrType = attr.getAttribute("type") || "string";
      const required = attr.getAttribute("use") === "required";

      if (attrName) {
        node.attributes?.push({
          name: attrName,
          type: attrType,
          required,
        });
      }
    });
  }
//TODO:POROVNAŤ NAVRHOVANĚ MAPOVANIE ČI SEDÍ S VÝSLEDKOM Z tibco. Ak nie doriešiť nesting + doriešiť aj grafické zobrazenie spojení.
  private resolveTypeReference(typeRef: string, node: IXSDNode, path: string): void {
    // Skip built-in XSD types
    if (typeRef.startsWith("xs:") || typeRef.startsWith("xsd:")) {
      console.log(`XSDParser: Skipping built-in type "${typeRef}"`);
      return;
    }

    console.log(`XSDParser: Resolving type reference "${typeRef}" for element "${node.name}"`);

    // Extract namespace prefix and local name
    const [, localName] = typeRef.includes(":") ? typeRef.split(":") : ["", typeRef];

    if (!this.schemaElement) {return;}

    // Try to find complexType or simpleType definition in the current schema
    const typeDef = this.findTypeDefinition(localName || typeRef);

    if (typeDef) {
      console.log(`XSDParser: Found type definition for "${typeRef}"`);
      this.parseComplexType(typeDef, node, path);
    } else {
      console.log(`XSDParser: Type "${typeRef}" not found in current schema (might be in imported schema)`);
      // Add a placeholder child to indicate external type
      node.children?.push({
        id: `node-${this.nodeIdCounter++}`,
        name: `[External type: ${typeRef}]`,
        type: "external",
        path: `${path}/[external]`,
        children: [],
        attributes: [],
        isExpanded: false,
      });
    }
  }

  private findTypeDefinition(typeName: string): Element | null {
    if (!this.schemaElement) {return null;}

    // Look for complexType with matching name
    const complexTypes = this.schemaElement.querySelectorAll(
      "xs\\:complexType[name], xsd\\:complexType[name], complexType[name]",
    );

    for (const ct of Array.from(complexTypes)) {
      if (ct.getAttribute("name") === typeName) {
        return ct as Element;
      }
    }

    // Look for simpleType with matching name
    const simpleTypes = this.schemaElement.querySelectorAll(
      "xs\\:simpleType[name], xsd\\:simpleType[name], simpleType[name]",
    );

    for (const st of Array.from(simpleTypes)) {
      if (st.getAttribute("name") === typeName) {
        return st as Element;
      }
    }

    return null;
  }

  generateSampleXSD(rootName = "root"): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://example.com/schema"
           elementFormDefault="qualified">
  
  <xs:element name="${rootName}">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="id" type="xs:string"/>
        <xs:element name="name" type="xs:string"/>
        <xs:element name="email" type="xs:string"/>
        <xs:element name="address">
          <xs:complexType>
            <xs:sequence>
              <xs:element name="street" type="xs:string"/>
              <xs:element name="city" type="xs:string"/>
              <xs:element name="zipCode" type="xs:string"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  
</xs:schema>`;
  }

  generateEmptyXSD(rootName = "Schema"): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" 
           targetNamespace="http://example.com/schema"
           elementFormDefault="qualified">
  
  <xs:element name="${rootName}">
    <xs:complexType>
      <xs:sequence>
        <!-- Load an XSD file to see the schema structure -->
      </xs:sequence>
    </xs:complexType>
  </xs:element>
  
</xs:schema>`;
  }
}
