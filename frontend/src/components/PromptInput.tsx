import React, { useRef, useEffect, useCallback, useState } from "react";
import { 
  Paperclip, ArrowUp, FileText, X, Square, FileSpreadsheet
} from "lucide-react";
import { cn } from "../lib/utils";
import { SourceDocument } from "../types";

export interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isProcessing?: boolean;
  onStop?: () => void;
  chatMode: "auto" | "research";
  onChatModeChange: (mode: "auto" | "research") => void;
  onAttachFile?: (file: File) => void;
  attachedDocuments?: SourceDocument[];
  onRemoveAttachment?: (docId: string) => void;
  onUnlinkDocument?: (docId: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
}

export default function PromptInput({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  isProcessing = false,
  onStop,
  chatMode,
  onChatModeChange,
  onAttachFile,
  attachedDocuments = [],
  onRemoveAttachment,
  onUnlinkDocument,
  placeholder = "Ask anything or research your documents…",
  minHeight = 46,
  maxHeight = 180,
  className,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleRemove = onRemoveAttachment || onUnlinkDocument;

  // Auto-resize textarea height dynamically based on content scrollHeight
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Reset height temporarily so scrollHeight calculation is accurate
    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;

    if (scrollHeight > maxHeight) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = "auto";
    } else {
      const clampedHeight = Math.max(minHeight, scrollHeight);
      textarea.style.height = `${clampedHeight}px`;
      textarea.style.overflowY = "hidden";
    }
  }, [minHeight, maxHeight]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !isProcessing) {
        onSubmit();
      }
    }
    onKeyDown?.(e);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file && onAttachFile) {
      onAttachFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onAttachFile) {
      onAttachFile(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "group relative w-full bg-surface-container-lowest border border-border rounded-2xl flex flex-col transition-all duration-150 shadow-sm",
        "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15",
        isDragging && "border-primary/80 ring-2 ring-primary/20 bg-primary/5",
        className
      )}
    >
      {/* Hidden file input for file attachments */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept=".pdf,.txt,.md,.docx"
      />

      {/* Drag & Drop Visual Overlay */}
      {isDragging && (
        <div className="absolute inset-0 rounded-2xl bg-surface/90 border-2 border-dashed border-primary flex items-center justify-center z-50 backdrop-blur-xs">
          <div className="flex items-center gap-2 text-primary font-medium text-xs">
            <Paperclip className="w-4 h-4 animate-bounce" />
            <span>Drop document to attach to chat context (.pdf, .txt, .md, .docx)</span>
          </div>
        </div>
      )}

      {/* Header: Inline Attachment Badges (Vercel AI Elements Attachment Preview style) */}
      {attachedDocuments.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1 overflow-x-auto custom-scrollbar shrink-0">
          {attachedDocuments.map((doc) => {
            const isSpreadsheet = doc.type === "spreadsheet";
            return (
              <div
                key={doc.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-container border border-border text-xs text-foreground shrink-0 shadow-xs"
                title={doc.name}
              >
                {isSpreadsheet ? (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
                <span className="truncate max-w-[130px] font-medium leading-tight">
                  {doc.name}
                </span>
                {doc.size && (
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {doc.size}
                  </span>
                )}
                {handleRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemove(doc.id)}
                    className="ml-0.5 p-0.5 rounded hover:bg-surface-container-high text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title="Remove attachment"
                    aria-label={`Remove ${doc.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Body: Auto-resizing Textarea */}
      <div className="px-3.5 pt-2 pb-1 flex-1 flex flex-col">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent border-none p-0 text-sm font-medium text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 leading-relaxed custom-scrollbar"
          style={{ minHeight: `${minHeight}px` }}
        />
      </div>

      {/* Footer: Tools & Actions Toolbar */}
      <div className="flex items-center justify-between px-2.5 pb-2 pt-1 border-t border-border/30 mt-1 select-none">
        {/* Left Tools */}
        <div className="flex items-center gap-2">
          {/* Quick Attach File Button */}
          {onAttachFile && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-container transition-colors cursor-pointer flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 active:scale-95"
              title="Attach document (PDF, TXT, MD, DOCX)"
              aria-label="Attach document"
            >
              <Paperclip className="w-4 h-4" />
            </button>
          )}

          {/* Segmented Mode Selector: Auto vs Research */}
          <div className="flex items-center bg-surface-container/70 border border-border/60 rounded-lg p-0.5 text-xs gap-0.5">
            <button
              type="button"
              onClick={() => onChatModeChange("auto")}
              className={cn(
                "px-2.5 py-0.5 rounded-md transition-colors duration-150 cursor-pointer font-medium text-[11px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 active:scale-95",
                chatMode === "auto"
                  ? "bg-surface-container-lowest text-foreground border-border shadow-xs font-semibold border"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface border border-transparent"
              )}
              title="Auto: Dynamic tool routing (Direct LLM, Documents, Web)"
            >
              Auto
            </button>
            <button
              type="button"
              onClick={() => onChatModeChange("research")}
              className={cn(
                "px-2.5 py-0.5 rounded-md transition-colors duration-150 cursor-pointer font-medium text-[11px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 active:scale-95",
                chatMode === "research"
                  ? "bg-surface-container-lowest text-foreground border-border shadow-xs font-semibold border"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface border border-transparent"
              )}
              title="Research: Multi-step iterative deep research"
            >
              Research
            </button>
          </div>
        </div>

        {/* Right Tools & Submit Button */}
        <div className="flex items-center gap-2">
          {/* Keyboard hint */}
          <div className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <span>Enter</span>
            <span className="text-[10px] font-mono opacity-80">↵</span>
          </div>

          {/* Submit / Stop Button */}
          {isProcessing ? (
            <button
              type="button"
              onClick={onStop}
              className="h-8 w-8 rounded-xl bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20 transition-all flex items-center justify-center cursor-pointer active:scale-95"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!value.trim() || isProcessing}
              className={cn(
                "h-8 w-8 rounded-xl transition-all duration-150 flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95",
                value.trim() && !isProcessing
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer"
                  : "bg-surface-container text-muted-foreground opacity-40 cursor-not-allowed border border-border/50"
              )}
              title="Send prompt (Enter)"
              aria-label="Send prompt"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.2]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
