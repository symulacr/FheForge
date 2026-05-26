"use client";

import { Handle, Position } from "reactflow";
import { Trash2, Lock } from "lucide-react";
import ProtocolIcon from "./protocol-icon";

type DefiNodeShellProps = {
  nodeId: string;
  selected?: boolean;
  title: string;
  protocolName?: string;
  rightLabel?: React.ReactNode;
  onDelete?: (id: string) => void;
  children: React.ReactNode;
};

export default function DefiNodeShell({
  nodeId,
  selected,
  title,
  protocolName = "CoFHE",
  rightLabel,
  onDelete,
  children,
}: DefiNodeShellProps) {
  return (
    <div
      className={`
        relative w-[360px] min-h-[210px]
        border
        bg-card
        text-white
        overflow-hidden
        transition-all duration-300
        ${selected ? "border-accent" : "border-border"}
      `}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!w-4 !h-4 !bg-accent !border-2 !border-border"
      />

      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(nodeId);
          }}
          className="absolute top-4 right-4 z-20 text-muted hover:text-destructive transition-colors"
        >
          <Trash2 size={16} />
        </button>
      )}

      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between pr-8">
          <div>
            <h3 className="text-[18px] md:text-[20px] font-bold leading-none tracking-tight text-foreground">
              {title}
            </h3>
            <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 border border-success/30 bg-success/10">
              <Lock size={10} className="text-success" />
              <span className="text-[10px] text-success font-medium">
                Encrypted
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <ProtocolIcon protocolName={protocolName} />
              <span className="text-[14px] text-muted leading-none">
                {protocolName}
              </span>
            </div>
          </div>

          {rightLabel ? (
            <div className="text-right">{rightLabel}</div>
          ) : (
            <div />
          )}
        </div>

        <div className="mt-4 h-px bg-border" />
      </div>

      <div className="px-5 pb-4">{children}</div>

      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!w-4 !h-4 !bg-accent !border-2 !border-border"
      />
    </div>
  );
}
