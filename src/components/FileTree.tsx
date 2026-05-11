"use client";

import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Brain,
  User,
  Ghost,
  BookOpen,
} from "lucide-react";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/**
 * Render the right icon for a file based on its name. Wrapped as a real
 * component (vs. a function returning a component type) so that React 19's
 * react-compiler doesn't complain about creating components during render.
 */
function FileIcon({
  name,
  className,
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const lower = name.toLowerCase();
  if (lower === "memory.md") return <Brain className={className} style={style} />;
  if (lower === "soul.md") return <Ghost className={className} style={style} />;
  if (lower === "user.md") return <User className={className} style={style} />;
  if (lower === "agents.md") return <BookOpen className={className} style={style} />;
  return <FileText className={className} style={style} />;
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const isSelected = selectedPath === node.path;
  const isFolder = node.type === "folder";

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      onSelect(node.path);
    }
  };

  const iconStyle = {
    color: isFolder
      ? "#F59E0B"
      : isSelected
      ? "var(--text-primary)"
      : "#60A5FA",
  };
  const iconClass = "w-3.5 h-3.5 md:w-4 md:h-4";

  return (
    <div>
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-1.5 md:py-2 text-xs md:text-sm rounded-lg transition-colors"
        style={{
          paddingLeft: `${8 + depth * 12}px`,
          backgroundColor: isSelected ? "var(--accent)" : "transparent",
          color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = "var(--border)";
            e.currentTarget.style.color = "var(--text-primary)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--text-secondary)";
          }
        }}
      >
        {isFolder && (
          <span className="w-3.5 h-3.5 md:w-4 md:h-4 flex items-center justify-center">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 md:w-3.5 md:h-3.5" />
            ) : (
              <ChevronRight className="w-3 h-3 md:w-3.5 md:h-3.5" />
            )}
          </span>
        )}
        {!isFolder && <span className="w-3.5 md:w-4" />}
        {isFolder ? (
          isExpanded ? (
            <FolderOpen className={iconClass} style={iconStyle} />
          ) : (
            <Folder className={iconClass} style={iconStyle} />
          )
        ) : (
          <FileIcon name={node.name} className={iconClass} style={iconStyle} />
        )}
        <span className="truncate">{node.name}</span>
      </button>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  return (
    <div className="py-1 md:py-2">
      {files.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
