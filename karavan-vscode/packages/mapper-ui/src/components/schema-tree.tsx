"use client"

import type { IXSDNode } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { LuChevronDown, LuChevronRight, LuCircle } from "react-icons/lu"

type SchemaTreeSide="source" | "target"
interface ISchemaTreeProps {
  nodes: IXSDNode[]
  onNodeClick?: (node: IXSDNode) => void
  selectedNodeId?: string
  side: SchemaTreeSide
  onDragStart?: (node: IXSDNode) => void
  onDrop?: (node: IXSDNode) => void
  mappedNodeIds?: Map<string, string> // Map of nodeId -> color
  isTreeExpanded?: boolean
}

export function SchemaTree({
  nodes,
  onNodeClick,
  selectedNodeId,
  side,
  onDragStart,
  onDrop,
  mappedNodeIds = new Map(),
  isTreeExpanded
}: ISchemaTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(isTreeExpanded)

  const toggleNode = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes)
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId)
    } else {
      newExpanded.add(nodeId)
    }
    setExpandedNodes(newExpanded)
  }


  useEffect(() => {
    if (isTreeExpanded) {
      const allIds = getAllNodeIds(nodes)
      setExpandedNodes(new Set(allIds))
      setAllExpanded(true)
    } else {
      setExpandedNodes(new Set())
      setAllExpanded(false)
    }
  }, [isTreeExpanded, nodes])

  const getAllNodeIds = (nodeList: IXSDNode[]): string[] => {
    const ids: string[] = []
    const collectIds = (node: IXSDNode) => {
      ids.push(node.id)
      if (node.children) {
        node.children.forEach(collectIds)
      }
    }
    nodeList.forEach(collectIds)
    return ids
  }

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedNodes(new Set())
      setAllExpanded(false)
    } else {
      const allIds = getAllNodeIds(nodes)
      setExpandedNodes(new Set(allIds))
      setAllExpanded(true)
    }
  }

  const renderNode = (node:IXSDNode, level = 0) => {
    const hasChildren = node.children && node.children.length > 0
    const isExpanded = expandedNodes.has(node.id)
    const isSelected = selectedNodeId === node.id
    const isMapped = mappedNodeIds.has(node.id)
    const connectionColor = mappedNodeIds.get(node.id) // Get color for this node

    return (
      <div key={node.id} className="select-none">
        <div
          data-node-id={node.id}
          data-side={side}
            className={cn(
              "flex items-center gap-2 py-1.5 px-2 hover:bg-accent/50 cursor-pointer rounded-sm transition-colors",
              isSelected && "bg-accent",
              isMapped && "border-l-4",
            )}
          style={{ 
            paddingLeft: `${level * 16 + 8}px`,
            ...(isMapped && connectionColor && {
              borderLeftColor: connectionColor,
              backgroundColor: `color-mix(in oklch, ${connectionColor} 10%, transparent)`,
            })
          }}
          draggable={side === "source"}
          onDragStart={(e) => {
            if (side === "source" && onDragStart) {
              e.dataTransfer.effectAllowed = "link"
              onDragStart(node)
            }
          }}
          onDragOver={(e) => {
            if (side === "target") {
              e.preventDefault()
              e.dataTransfer.dropEffect = "link"
            }
          }}
          onDrop={(e) => {
            if (side === "target" && onDrop) {
              e.preventDefault()
              onDrop(node)
            }
          }}
          onClick={() => {
            if (hasChildren) {
              toggleNode(node.id)
            }
            onNodeClick?.(node)
          }}
        >

          {hasChildren ? (
            <button
              className="p-0 h-4 w-4 flex items-center justify-center"
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.id)
              }}
            >
              {isExpanded ? (
                <LuChevronDown className="h-3 w-3 text-muted-foreground" />
              ) : (
                <LuChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          ) : (
            <LuCircle
              className={cn(
                "h-2 w-2 ml-1",
                isMapped ? "" : "fill-muted-foreground text-muted-foreground",
              )}
              style={isMapped && connectionColor ? {
                fill: connectionColor,
                color: connectionColor,
              } : {}}
            />
          )}
<span className="text-muted-foreground font-mono text-base">{(() => {
                if (node.type.includes(':')) {
                const prefix = node.type.includes(':') ? node.type.split(':')[0] + ':' : '';
                return prefix ;
              }
            })()}</span>
          <span className="text-base font-mono">{(() => {
              if (node.name.includes('.')) {
                const parts = node.name.split('.');
                const lastPart = parts[parts.length - 1];
                const prefix = node.name.includes(':') ? node.name.split(':')[0] + ':' : '';
                return prefix + lastPart;
              }
              return node.name;
            })()}</span>
          <span className="text-sm text-muted-foreground font-mono">
            : {(() => {
              if (node.type.includes('.')) {
                const parts = node.type.split('.');
                const lastPart = parts[parts.length - 1];
                const prefix = node.type.includes(':') ? node.type.split(':')[0] + ':' : '';
                return prefix + lastPart;
              }
              return node.type;
            })()}
            {node.namespace && (
              <span className="ml-1 opacity-60" title={node.namespace}>
                [{node.namespace.split('/').pop() || node.namespace.split(".").pop() || node.namespace.substring(0, 20)}]
              </span>
            )}
          </span>
        </div>
        {hasChildren && isExpanded && <div>{node.children!.map((child) => renderNode(child, level + 1))}</div>}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none pb-2">
        <button
          onClick={toggleExpandAll}
          className="text-sm text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-0.5">
        {nodes?.map((node) => renderNode(node))}
      </div>
    </div>
  )
}
