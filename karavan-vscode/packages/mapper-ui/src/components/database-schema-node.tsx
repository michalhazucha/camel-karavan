import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { memo } from "react";
import type { XSDElement } from "../lib/types";

export interface DatabaseSchemaNodeData {
  label: string;
  element?: XSDElement;
  children?: XSDElement[];
}

export const DatabaseSchemaNode = memo((props: NodeProps) => {
  const data = props.data as unknown as DatabaseSchemaNodeData;
  const { label, children = [] } = data;

  return (
    <div className="bg-white border-2 border-gray-200 rounded-lg p-4 min-w-[200px] shadow-lg">
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#555' }}
        isConnectable={true}
      />
      
      <div className="font-bold text-sm mb-2 text-center">
        {label}
      </div>
      
      {children.length > 0 && (
        <div className="space-y-1">
          {children.slice(0, 5).map((child: XSDElement, index: number) => (
            <div
              key={index}
              className="text-xs p-1 bg-gray-50 rounded border text-left"
            >
              <span className="font-medium">{child.name}</span>
              {child.type && (
                <span className="text-gray-500 ml-2">({child.type})</span>
              )}
            </div>
          ))}
          {children.length > 5 && (
            <div className="text-xs text-gray-500 text-center">
              ... and {children.length - 5} more
            </div>
          )}
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#555' }}
        isConnectable={true}
      />
    </div>
  );
});

DatabaseSchemaNode.displayName = 'DatabaseSchemaNode';