"use client"


import type { IMappingConnection, IXSDNode } from "@/lib/types"
import { connectionColors } from "@/lib/variables"
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useEffect } from "react"

interface FlowVisualizerProps {
  sourceNodes: IXSDNode[]|undefined
  targetNodes: IXSDNode[]|undefined
  connections: IMappingConnection[]
  getConnectionColor?: (connectionId: string) => string
  xsltMappings?: Array<{
    sourcePath: string
    targetPath: string
    isConditional?: boolean
    condition?: string
  }>
}

export function FlowVisualizer({ sourceNodes, targetNodes, connections, getConnectionColor, xsltMappings }: FlowVisualizerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([])
  
  const getColor = (connId: string): string => {
    if (getConnectionColor) {
      return getConnectionColor(connId)
    }
    const index = connections.findIndex(c => c.id === connId)
    return connectionColors[index % connectionColors.length]
  }

  useEffect(() => {
    const flowNodes = []
    const flowEdges = []

    // Add START node
    flowNodes.push({
      id: 'start',
      type: 'input',
      position: { x: 50, y: 300 },
      data: {
        label: (
          <div className="text-sm font-bold">
            <div>▶ START</div>
          </div>
        ),
      },
      style: {
        background: 'hsl(var(--primary))',
        color: 'hsl(var(--primary-foreground))',
        border: '2px solid hsl(var(--primary))',
        borderRadius: '20px',
        padding: '12px 20px',
        fontSize: '14px',
        fontWeight: 'bold',
      },
    })

    // Create nodes for each connection with proper spacing
    connections.forEach((conn, index) => {
      const color = getColor(conn.id)
      const yPos = 100 + index * 120
      const transformation = conn.transformation

      // Source node
      const sourceNodeData = sourceNodes && findNodeById(sourceNodes, conn.sourceId)
      if (sourceNodeData) {
        flowNodes.push({
          id: `source-${conn.id}`,
          type: 'default',
          position: { x: 250, y: yPos },
          data: {
            label: (
              <div className="text-xs">
                <div className="font-bold text-[11px] mb-1">SOURCE</div>
                <div className="font-semibold">{sourceNodeData.name}</div>
                <div className="text-muted-foreground text-[10px] mt-1">{sourceNodeData.type}</div>
              </div>
            ),
          },
          style: {
            background: `hsl(var(--${color}) / 0.15)`,
            color: 'hsl(var(--foreground))',
            border: `3px solid hsl(var(--${color}))`,
            borderRadius: '8px',
            padding: '10px',
            width: 180,
          },
        })

        // Connect START to first source
        if (index === 0) {
          flowEdges.push({
            id: 'edge-start-source',
            source: 'start',
            target: `source-${conn.id}`,
            animated: false,
            style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
          })
        }
      }

      // Transformation node
      const transformType = transformation?.type || 'direct'
      const transformLabel = {
        'direct': 'Direct',
        'function': 'Function',
        'conditional': 'Conditional',
        'variable': 'Variable',
        'inline-variable': 'Inline Var',
        'nested-variable': 'Nested Var',
        'logger': 'Logger',
        'concat': 'Concat',
        'substring': 'Substring',
      }[transformType] || 'Transform'

      flowNodes.push({
        id: `transform-${conn.id}`,
        type: 'default',
        position: { x: 480, y: yPos },
        data: {
          label: (
            <div className="text-xs text-center">
              <div className="font-bold text-[10px] mb-1">MAPPER</div>
              <div className="font-semibold">{transformLabel}</div>
              {transformation?.customXPath && (
                <div className="text-[9px] text-muted-foreground mt-1 truncate max-w-[100px]">
                  {transformation.customXPath.substring(0, 20)}...
                </div>
              )}
              {transformation?.condition && (
                <div className="text-[9px] mt-1 text-yellow-600 dark:text-yellow-400">
                  ⚠ if-test
                </div>
              )}
            </div>
          ),
        },
        style: {
          background: transformType === 'conditional' 
            ? 'hsl(48 96% 53% / 0.2)' 
            : transformType === 'variable' || transformType === 'inline-variable'
            ? 'hsl(262 83% 58% / 0.2)'
            : 'hsl(var(--accent))',
          color: 'hsl(var(--foreground))',
          border: `2px ${transformType === 'conditional' ? 'dashed' : 'solid'} ${color}`,
          borderRadius: '8px',
          padding: '10px',
          width: 140,
        },
      })

      // Target node
      const targetNodeData = targetNodes && findNodeById(targetNodes, conn.targetId)
      if (targetNodeData) {
        flowNodes.push({
          id: `target-${conn.id}`,
          type: 'default',
          position: { x: 670, y: yPos },
          data: {
            label: (
              <div className="text-xs">
                <div className="font-bold text-[11px] mb-1">TARGET</div>
                <div className="font-semibold">{targetNodeData.name}</div>
                <div className="text-muted-foreground text-[10px] mt-1">{targetNodeData.type}</div>
              </div>
            ),
          },
          style: {
            background: `color-mix(in oklch, ${color} 15%, transparent)`,
            color: 'hsl(var(--foreground))',
            border: `3px solid ${color}`,
            borderRadius: '8px',
            padding: '10px',
            width: 180,
          },
        })
      }

      // Edges with colors
      flowEdges.push({
        id: `edge-source-transform-${conn.id}`,
        source: `source-${conn.id}`,
        target: `transform-${conn.id}`,
        animated: true,
        style: { 
          stroke: color, 
          strokeWidth: 3 
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color,
        },
      })

      flowEdges.push({
        id: `edge-transform-target-${conn.id}`,
        source: `transform-${conn.id}`,
        target: `target-${conn.id}`,
        animated: true,
        style: {
          stroke: color,
          strokeWidth: 3,
          strokeDasharray: transformType === 'conditional' ? '5,5' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color,
        },
      })

      // Connect previous target to next source (flow continuation)
      if (index > 0) {
        flowEdges.push({
          id: `edge-flow-${index}`,
          source: `target-${connections[index - 1].id}`,
          target: `source-${conn.id}`,
          animated: false,
          style: { 
            stroke: 'hsl(var(--muted-foreground))', 
            strokeWidth: 1,
            strokeDasharray: '3,3',
          },
          type: 'smoothstep',
        })
      }
    })

    // Add END node
    if (connections.length > 0) {
      const lastConn = connections[connections.length - 1]
      flowNodes.push({
        id: 'end',
        type: 'output',
        position: { x: 900, y: 100 + (connections.length - 1) * 120 },
        data: {
          label: (
            <div className="text-sm font-bold">
              <div>■ END</div>
            </div>
          ),
        },
        style: {
          background: 'hsl(var(--destructive))',
          color: 'hsl(var(--destructive-foreground))',
          border: '2px solid hsl(var(--destructive))',
          borderRadius: '20px',
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: 'bold',
        },
      })

      flowEdges.push({
        id: 'edge-target-end',
        source: `target-${lastConn.id}`,
        target: 'end',
        animated: false,
        style: { stroke: 'hsl(var(--primary))', strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--primary))' },
      })
    }
    setNodes(flowNodes)
    setEdges(flowEdges)
  }, [sourceNodes, targetNodes, connections, getConnectionColor, xsltMappings, setNodes, setEdges])

  return (
    <div className="w-full h-[600px] border border-border rounded-md bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Cross} gap={12} size={0.1} bgColor="transparent"/>
        <Controls />
      </ReactFlow>
    </div>
  )
}

// Helper function to find a node by ID in the tree
function findNodeById(nodes: IXSDNode[], id: string): IXSDNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    if (node.children) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

// function flattenNodes(nodes: XSDNode[]): XSDNode[] {
//   const result: XSDNode[] = []

//   function traverse(nodeList: XSDNode[]) {
//     for (const node of nodeList) {
//       result.push(node)
//       if (node.children) {
//         traverse(node.children)
//       }
//     }
//   }

//   traverse(nodes)
//   return result
// }
