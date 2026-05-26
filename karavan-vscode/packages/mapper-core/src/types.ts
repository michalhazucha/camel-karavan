// Types for XSLT Mapper Extension

export interface XSDElement {
  name: string;
  type?: string;
  minOccurs?: string;
  maxOccurs?: string;
  children?: XSDElement[];
  attributes?: IXSDAttribute[];
  path?: string;
}

export interface IXSDAttribute {
  name: string;
  type?: string;
  use?: string;
  required?: boolean

}

export interface XSDComplexType {
  name: string;
  elements: XSDElement[];
  attributes: IXSDAttribute[];

}

export interface XSLTMapping {
  source: string;
  target: string;
  type: 'element' | 'attribute' | 'value';
  template?: string;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    element?: XSDElement;
    children?: XSDElement[];
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface ISchemaTreeNode {
  id: string;
  name: string;
  type?: string;
  path: string;
  children?: ISchemaTreeNode[];
  attributes?: IXSDAttribute[];
  level: number;
  isExpanded?: boolean;
}



// Types for XSD schema tree structure
export interface IXSDNode {
  id: string
  name: string
  type: string
  path: string
  namespace?: string
  children?: IXSDNode[]
  attributes?: IXSDAttribute[]
  isExpanded?: boolean
  minOccurs?: string
  maxOccurs?: string
  nillable?: boolean
}

export interface IXSDSchema {
  targetNamespace?: string
  elementFormDefault?: string
  elements?: XSDElement[];
  complexTypes?: XSDComplexType[];
  nodes?: IXSDNode[]
  
}
export enum MappingTransformationType {
  DIRECT = 'direct',
  CONCAT = 'concat',
  SUBSTRING = 'substring',
  CONDITIONAL = 'conditional',
  VARIABLE = 'variable',
  FUNCTION = 'function',
  INLINE_VARIABLE = 'inline-variable',
  NESTED_VARIABLE = 'nested-variable',
 //TIBCO Logger
  LOGGER = 'logger',
}

enum VariablesPosition {
  BEFORE = 'before',
  INLINE = 'inline',
  AFTER = 'after',
}
// Types for mapping connections
export interface IMappingConnection {
  id: string
  sourceId: string
  targetId: string
  sourcePath: string
  targetPath: string
  transformation?: IMappingTransformation
  type?: MappingTransformationType
}

export interface IMappingTransformation {
  type: MappingTransformationType

  // For direct mapping
  directValue?: string

  // For concat
  parts?: Array<{ type: 'literal' | 'xpath'; value: string }>

  // For conditional
  condition?: string
  thenValue?: string
  elseValue?: string

  // For variable
  variableName?: string
  variableExpression?: string
  variablePosition?: VariablesPosition // Where to place the variable

  // For inline variables (TIBCO style)
  inlineVariables?: Array<{
    name: string
    expression: string
    usedInExpression?: string // The expression that uses this variable
  }>

  // For functions
  functionName?: string
  functionArgs?: string[]

  // For custom XPath
  customXPath?: string

  // For nested structure with variables
  hasNestedVariable?: boolean
  nestedStructure?: {
    outerElement: string
    innerElement: string
    variableName: string
    variableExpression: string
    valueExpression: string
  }

  // For TIBCO Logger (Response logging/filtering pattern)
  sourceVariable?: string // e.g., 'fetchESimProfileStatusCore' instead of 'Start'
  copyNilAttributes?: boolean // Copy @xsi:nil attributes
  addConditionalWrapper?: boolean // Wrap in <xsl:if> for optional elements (minOccurs="0")
  hardcodedValue?: string // Replace value with hardcoded string (e.g., "Omitted for logging")
}

export interface IMapperProject {
  name: string
  sourceSchema: IXSDSchema | null
  targetSchema: IXSDSchema | null
  connections: IMappingConnection[]
}

export interface MappingConnection {
  id: string
  sourceId: string
  targetId: string
  sourcePath: string
  targetPath: string
  transformation?: string
}
export enum TransformationTypes {
  VALUE_OF = "value-of",
  COPY_OF = "copy-of",
  TEMPLATE = "template",
  CUSTOM = "custom"
}
export interface IXSLTMapping {
  sourcePath: string
  targetPath: string
  transformationType: TransformationTypes
  expression?: string
  isConditional?: boolean
  condition?: string
}

export interface IXSDNode {
  id: string
  name: string
  type: string
  path: string
  namespace?: string
  children?: IXSDNode[]
  attributes?: IXSDAttribute[]
  isExpanded?: boolean
  required?: any
}

export interface IDatabaseSchemaNodeData {
  label: string;
  element?: XSDElement;
  children?: XSDElement[];
}


export enum ButtonVariant {
  Outline = "outline",
  Default = "default",
  Link = "link",
  Destructive = "destructive",
  Secondary = "secondary",
  Ghost = "ghost"
}

