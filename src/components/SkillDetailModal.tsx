"use client";

import { X, FolderOpen, ExternalLink, FileText, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

interface Skill {
  id: string;
  name: string;
  description: string;
  location: string;
  source: "workspace" | "system";
  homepage?: string;
  emoji?: string;
  fileCount: number;
  fullContent: string;
  files: string[];
}

interface SkillDetailModalProps {
  skill: Skill;
  onClose: () => void;
}

export function SkillDetailModal({ skill, onClose }: SkillDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"readme" | "files">("readme");

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const displayContent = skill.fullContent.replace(
    /^---[\s\S]*?---\s*\n/,
    ""
  );

  const memoryBrowserPath = encodeURIComponent(skill.location);
  
  const iconBgColor = skill.source === "workspace" 
    ? "rgba(168, 85, 247, 0.15)" 
    : "rgba(59, 130, 246, 0.15)";
  
  const iconColor = skill.source === "workspace" ? "#A855F7" : "#3B82F6";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between p-6"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-4">
            <div 
              className="p-3 rounded-lg"
              style={{ backgroundColor: iconBgColor }}
            >
              {skill.emoji ? (
                <span className="text-2xl">{skill.emoji}</span>
              ) : (
                <Puzzle className="w-6 h-6" style={{ color: iconColor }} />
              )}
            </div>
            <div>
              <h2 
                className="text-xl font-bold"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
              >
                {skill.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: skill.source === "workspace" 
                      ? "rgba(168, 85, 247, 0.2)" 
                      : "rgba(59, 130, 246, 0.2)",
                    color: skill.source === "workspace" ? "#C4B5FD" : "#93C5FD"
                  }}
                >
                  {skill.source === "workspace" ? "Workspace" : "System"}
                </span>
                {skill.homepage && (
                  <a
                    href={skill.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs transition-colors hover:opacity-80"
                    style={{ color: "var(--accent)" }}
                  >
                    <ExternalLink className="w-3 h-3" />
                    Homepage
                  </a>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-secondary)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Location bar */}
        <div 
          className="px-6 py-3 flex items-center justify-between"
          style={{ backgroundColor: "rgba(26, 26, 26, 0.5)" }}
        >
          <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <FolderOpen className="w-4 h-4" />
            <code style={{ color: "var(--text-primary)" }}>{skill.location}</code>
          </div>
          <a
            href={`/search?q=path:${memoryBrowserPath}`}
            className="flex items-center gap-1.5 text-sm transition-colors hover:opacity-80"
            style={{ color: "var(--accent)" }}
          >
            <ExternalLink className="w-4 h-4" />
            Open in Memory Browser
          </a>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: "1px solid var(--border)" }}>
          <button
            onClick={() => setActiveTab("readme")}
            className="px-6 py-3 text-sm font-medium transition-colors"
            style={{
              color: activeTab === "readme" ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: activeTab === "readme" ? "2px solid var(--accent)" : "2px solid transparent"
            }}
          >
            SKILL.md
          </button>
          <button
            onClick={() => setActiveTab("files")}
            className="px-6 py-3 text-sm font-medium transition-colors"
            style={{
              color: activeTab === "files" ? "var(--accent)" : "var(--text-secondary)",
              borderBottom: activeTab === "files" ? "2px solid var(--accent)" : "2px solid transparent"
            }}
          >
            Files ({skill.fileCount})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "readme" && (
            <div className="prose prose-invert max-w-none prose-headings:font-semibold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded"
              style={{ 
                "--tw-prose-body": "var(--text-secondary)",
                "--tw-prose-headings": "var(--text-primary)",
                "--tw-prose-links": "var(--accent)",
                "--tw-prose-code": "var(--text-primary)"
              } as React.CSSProperties}
            >
              <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{displayContent}</ReactMarkdown>
            </div>
          )}

          {activeTab === "files" && (
            <div className="space-y-1">
              {skill.files.length === 0 ? (
                <p className="text-center py-8" style={{ color: "var(--text-secondary)" }}>
                  No files found
                </p>
              ) : (
                skill.files.map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors"
                    style={{ backgroundColor: "rgba(26, 26, 26, 0.5)" }}
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
                    <span className="text-sm font-mono" style={{ color: "var(--text-primary)" }}>
                      {file}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
