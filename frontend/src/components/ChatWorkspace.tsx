import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Message, SourceDocument, Citation, MessageTelemetry } from "../types";
import { 
  Paperclip, FileText, FileSpreadsheet, 
  PanelRightClose, PanelRightOpen, BrainCircuit, Layers, Settings2, 
  CheckCircle2, Search, ArrowRight, ArrowDown, Plus, Loader2, AlertTriangle, X,
  Copy, ThumbsUp, ThumbsDown, Check, RotateCcw, ChevronDown, Database,
  Quote, ExternalLink, Activity, Cpu, AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { toast } from "sonner";
import FeedbackDialog from "./FeedbackDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PromptInput from "./PromptInput";
import { useStore } from "../store/useStore";
import BrandLogo, { KnowvexRadialLoader } from "./brand/KnowvexLogo";
import Shimmer from "./ui/shimmer";

const EMPTY_DOCS: SourceDocument[] = [];
const STARTING_GRAPH_STATUS = [{ node: "main_router", label: "Deciding route", status: "running" }];

function renderTableCellContent(content: React.ReactNode): React.ReactNode {
  if (typeof content === "string") {
    if (!/<br\s*\/?>/i.test(content)) return content;
    const parts = content.split(/<br\s*\/?>/gi);
    return parts.map((part, idx) => (
      <React.Fragment key={idx}>
        {idx > 0 && <br />}
        {part}
      </React.Fragment>
    ));
  }
  if (Array.isArray(content)) {
    return content.map((item, i) => (
      <React.Fragment key={i}>{renderTableCellContent(item)}</React.Fragment>
    ));
  }
  return content;
}

const getActiveStepLabel = (statuses: any[]): string => {
  if (!statuses || statuses.length === 0) return "Thinking";
  const running = [...statuses].reverse().find((s: any) => s.status === "running");
  if (running) {
    const raw = running.label || running.message || running.node || "Processing";
    return String(raw).replace(/[.…]+$/, "");
  }
  const lastActive = [...statuses].reverse().find((s: any) => s.status !== "completed") || statuses[statuses.length - 1];
  const raw = lastActive?.label || lastActive?.message || lastActive?.node || "Processing";
  return String(raw).replace(/[.…]+$/, "");
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="my-4 w-full max-w-full overflow-hidden rounded-xl border border-border bg-surface-container-lowest">
      <div className="flex items-center justify-between border-b border-border px-3.5 py-1.5 bg-surface-container">
        <span className="text-xs font-medium text-muted-foreground">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          title="Copy code"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 text-xs font-mono leading-6 text-foreground bg-surface-container-lowest">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export const cleanMessageText = (text: string): string => {
  if (!text) return "";
  return text
    // Clean up spaces before punctuation
    .replace(/ +([.,;:?!])/g, "$1");
};

export const transformBracketCitations = (text: string, citations?: Citation[]): string => {
  if (!text) return "";

  const lines = text.split("\n");
  let inCodeBlock = false;

  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;

    // Split by inline backticks so code spans are preserved without alterations
    const segments = line.split("`");
    const processedSegments = segments.map((seg, sIdx) => {
      // Odd indices are inside inline code: leave untouched
      if (sIdx % 2 === 1) return seg;

      let s = seg;

      // 1. Bracketed chunk_id: 【67bb9d91487d4bbe】 or 【chunk_id=...】
      s = s.replace(/【(?:chunk_id=)?([a-zA-Z0-9_-]{6,})】/g, (match, chunkId) => {
        const cleanId = chunkId.replace(/['"]/g, "").trim();
        let idx = 0;
        let label = "1";
        if (citations && citations.length > 0) {
          const foundIdx = citations.findIndex(
            (c) =>
              c.chunk_id === cleanId ||
              (c.chunk_id && cleanId.includes(c.chunk_id)) ||
              (c.chunk_id && c.chunk_id.includes(cleanId))
          );
          idx = foundIdx !== -1 ? foundIdx : 0;
          const cite = citations[idx];
          const pageNum = cite?.page ?? cite?.page_label ?? cite?.page_number;
          label = pageNum != null ? `Page ${pageNum}` : `${idx + 1}`;
        }
        return `[${label}](cite://${idx})`;
      });

      // 2. Bracketed chunk_id tag: [chunk_id=...]
      s = s.replace(/\[chunk_id=([^\]]+)\]/g, (match, chunkId) => {
        const cleanId = chunkId.replace(/['"]/g, "").trim();
        let idx = 0;
        let label = "1";
        if (citations && citations.length > 0) {
          const foundIdx = citations.findIndex(
            (c) =>
              c.chunk_id === cleanId ||
              (c.chunk_id && cleanId.includes(c.chunk_id)) ||
              (c.chunk_id && c.chunk_id.includes(cleanId))
          );
          idx = foundIdx !== -1 ? foundIdx : 0;
          const cite = citations[idx];
          const pageNum = cite?.page ?? cite?.page_label ?? cite?.page_number;
          label = pageNum != null ? `Page ${pageNum}` : `${idx + 1}`;
        }
        return `[${label}](cite://${idx})`;
      });

      // 3. Numeric citations: [1], [2], [1, 2], [1, 2, 3], or ranges [1-3]
      // Negative lookbehind: not preceded by [ or ]
      // Negative lookahead: not followed by ( (markdown link) or : (reference link)
      s = s.replace(/(?<![\[\]])\[([0-9]+(?:\s*-\s*[0-9]+|\s*,\s*[0-9]+)*)\](?!\s*[:\(])/g, (match, numGroup) => {
        // Handle range e.g. 1-3
        const rangeMatch = numGroup.match(/^([0-9]+)\s*-\s*([0-9]+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 10) {
            const badges: string[] = [];
            for (let n = start; n <= end; n++) {
              const idx = Math.max(0, n - 1);
              badges.push(`[${n}](cite://${idx})`);
            }
            return badges.join("");
          }
        }

        const numbers = numGroup
          .split(",")
          .map((item: string) => parseInt(item.trim(), 10))
          .filter((n: number) => !isNaN(n));
        if (numbers.length === 0) return match;
        return numbers
          .map((n: number) => {
            const idx = Math.max(0, n - 1);
            return `[${n}](cite://${idx})`;
          })
          .join("");
      });

      // 4. [Page X], [Pages X], [p. X], [pp. X]
      s = s.replace(/(?<![\[\]])\[(?:Pages?|pp?\.)\s*([0-9]+)\](?!\s*[:\(])/gi, (match, pageStr) => {
        const pageNum = parseInt(pageStr, 10);
        let idx = 0;
        if (citations && citations.length > 0) {
          const found = citations.findIndex(
            (c) => (c.page ?? c.page_label ?? c.page_number) === pageNum
          );
          if (found !== -1) idx = found;
        }
        return `[Page ${pageNum}](cite://${idx})`;
      });

      // 5. [Doc X], [Document X], [Source X], [Ref X]
      s = s.replace(/(?<![\[\]])\[(?:Docs?|Documents?|Source|Ref)(?::|\s+)\s*([0-9]+|[a-zA-Z0-9_.-]+)\](?!\s*[:\(])/gi, (match, docRef) => {
        const n = parseInt(docRef, 10);
        const idx = !isNaN(n) ? Math.max(0, n - 1) : 0;
        return `[Doc ${docRef}](cite://${idx})`;
      });

      return s;
    });

    return processedSegments.join("`");
  });

  return processedLines.join("\n");
};

const markdownCache = new Map<string, string>();

const formatAssistantMarkdown = (text: string, citations?: Citation[]) => {
  if (!text) return "";
  const cacheKey = `${text}_${citations?.length || 0}`;
  if (markdownCache.has(cacheKey)) {
    return markdownCache.get(cacheKey)!;
  }

  let inFence = false;
  let sectionIndex = 0;
  const cleanedText = cleanMessageText(text);
  const withCitations = transformBracketCitations(cleanedText, citations);

  const formatted = withCitations
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !trimmed) return line;

      // Do not alter markdown table rows or separator lines
      if (trimmed.startsWith("|") || trimmed.includes(" | ") || /^[-:| ]+$/.test(trimmed)) {
        return line;
      }

      const boldLeadIn = trimmed.match(/^\*\*([^*:]{3,90}):\*\*\s*(.*)$/);
      if (boldLeadIn) {
        sectionIndex += 1;
        return boldLeadIn[2]
          ? `\n### ${sectionIndex}. ${boldLeadIn[1]}\n\n${boldLeadIn[2]}`
          : `\n### ${sectionIndex}. ${boldLeadIn[1]}`;
      }

      const labelLine = trimmed.match(/^([A-Z][A-Za-z0-9/() ,.&'"-]{2,90}):\s*(.*)$/);
      if (labelLine && labelLine[1].includes(" ")) {
        sectionIndex += 1;
        return labelLine[2]
          ? `\n### ${sectionIndex}. ${labelLine[1]}\n\n${labelLine[2]}`
          : `\n### ${sectionIndex}. ${labelLine[1]}`;
      }

      if (/^(conclusion|summary|overview)$/i.test(trimmed)) {
        return `\n### ${trimmed}`;
      }
      return line;
    })
    .join("\n");

  if (markdownCache.size > 200) {
    markdownCache.clear();
  }
  markdownCache.set(cacheKey, formatted);
  return formatted;
};

// ---------------------------------------------------------------------------
// Perplexity-Style Inline Citation Component
// ---------------------------------------------------------------------------
interface InlineCitationProps {
  citation?: Citation;
  index: number;
  label: React.ReactNode;
  onSelect?: (citation: Citation) => void;
}

export function InlineCitation({ citation, index, label, onSelect }: InlineCitationProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isHovered) return;
    const handleScroll = () => {
      setIsHovered(false);
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isHovered]);

  const showHoverCard = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      const cardWidth = 320;
      let left = rect.left + rect.width / 2 - cardWidth / 2;
      left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, left));
      const placeAbove = rect.top > 200;
      const top = placeAbove ? rect.top - 8 : rect.bottom + 8;
      setCoords({ top, left, placeAbove });
    }
    setIsHovered(true);
  };

  const hideHoverCard = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (citation && onSelect) {
      onSelect(citation);
    }
  };

  const isWeb = citation?.type === "web";
  const name = citation?.name || citation?.title || (citation?.url ? "Web Source" : "Knowledge Base Document");
  const pageNum = citation?.page ?? citation?.page_label ?? citation?.page_number;
  const badgeText = isWeb ? "Web" : pageNum != null ? `Page ${pageNum}` : "Doc";
  const snippet = citation?.snippet || citation?.excerpt || citation?.text || "";

  const rawLabel = String(label);
  const displayLabel = rawLabel.startsWith("[") && rawLabel.endsWith("]") ? rawLabel : `[${rawLabel}]`;

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        onMouseEnter={showHoverCard}
        onMouseLeave={hideHoverCard}
        onClick={handleClick}
        className={cn(
          "inline-flex items-center justify-center font-mono text-[10.5px] font-semibold leading-none",
          "text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 hover:border-primary/50",
          "rounded px-1.5 py-0.5 mx-0.5 align-baseline transition-all duration-150 cursor-pointer select-none shadow-2xs hover:shadow-xs active:scale-95"
        )}
        title={name}
        aria-label={`Citation ${rawLabel}: ${name}`}
      >
        {displayLabel}
      </button>

      {isHovered && coords && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.placeAbove ? "translateY(-100%)" : "none",
            zIndex: 9999,
          }}
          onMouseEnter={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }}
          onMouseLeave={hideHoverCard}
          className="w-80 pointer-events-auto select-none"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: coords.placeAbove ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            onClick={handleClick}
            className="rounded-xl bg-surface/90 dark:bg-zinc-900/90 backdrop-blur-md border border-border/80 shadow-2xl p-3.5 text-left cursor-pointer transition-all hover:border-primary/50"
          >
            {/* Header: Type icon, Document Name, Page badge */}
            <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-2">
              <div className="flex items-center gap-2 min-w-0">
                {isWeb ? (
                  <Search className="w-3.5 h-3.5 text-primary shrink-0" />
                ) : name.endsWith(".xlsx") || name.endsWith(".csv") ? (
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
                <span className="font-semibold text-xs text-foreground truncate max-w-[170px]" title={name}>
                  {name}
                </span>
              </div>
              <span className="text-[10px] font-bold font-mono bg-primary/15 text-primary border border-primary/25 px-1.5 py-0.5 rounded shrink-0">
                {badgeText}
              </span>
            </div>

            {/* Snippet quote */}
            <div className="mt-2.5 p-2 rounded-lg bg-surface-container/60 dark:bg-zinc-800/50 border-l-2 border-primary text-[11px] leading-relaxed text-foreground/80 italic font-serif line-clamp-4">
              "{snippet || "Grounded context chunk retrieved from knowledge store."}"
            </div>

            {/* Footer action hint */}
            <div className="mt-2.5 pt-1.5 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Click to open in inspector</span>
              <ExternalLink className="w-3 h-3 text-primary" />
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Telemetry Badge with Glassmorphic HoverCard Breakdown
// ---------------------------------------------------------------------------
export function TelemetryBadge({ telemetry }: { telemetry?: MessageTelemetry }) {
  const showTelemetry = useStore((s) => s.showTelemetry);
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isHovered) return;
    const handleScroll = () => {
      setIsHovered(false);
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isHovered]);

  if (!showTelemetry || !telemetry) return null;

  const totalTokens = telemetry.total_tokens || ((telemetry.prompt_tokens || 0) + (telemetry.completion_tokens || 0));
  const latency = telemetry.latency ?? (telemetry.latency_ms ? telemetry.latency_ms / 1000 : null);

  if (!totalTokens && latency === null) return null;

  const formatTokens = (t: number) => {
    if (t >= 1000) return `${(t / 1000).toFixed(1)}k tokens`;
    return `${t} tokens`;
  };

  const latencyStr = latency !== null ? `${latency < 1 ? latency.toFixed(2) : latency.toFixed(1)}s` : null;

  const badgeText = totalTokens && latencyStr
    ? `${formatTokens(totalTokens)} • ${latencyStr}`
    : totalTokens
    ? formatTokens(totalTokens)
    : latencyStr!;

  const showHoverCard = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      const cardWidth = 260;
      let left = rect.left + rect.width / 2 - cardWidth / 2;
      left = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, left));
      const placeAbove = rect.top > 180;
      const top = placeAbove ? rect.top - 8 : rect.bottom + 8;
      setCoords({ top, left, placeAbove });
    }
    setIsHovered(true);
  };

  const hideHoverCard = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 180);
  };

  return (
    <>
      <button
        ref={badgeRef}
        type="button"
        onMouseEnter={showHoverCard}
        onMouseLeave={hideHoverCard}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono text-muted-foreground/80 hover:text-foreground bg-surface-container/40 hover:bg-surface-container border border-border/50 hover:border-border transition-colors cursor-pointer select-none"
        title="Execution Telemetry"
      >
        <Activity className="w-3 h-3 text-primary/70" />
        <span>{badgeText}</span>
      </button>

      {isHovered && coords && typeof document !== "undefined" && createPortal(
        <div
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            transform: coords.placeAbove ? "translateY(-100%)" : "none",
            zIndex: 9999,
          }}
          onMouseEnter={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }}
          onMouseLeave={hideHoverCard}
          className="w-64 pointer-events-auto select-none"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: coords.placeAbove ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="rounded-xl bg-surface/90 dark:bg-zinc-900/90 backdrop-blur-md border border-border/80 shadow-2xl p-3 text-left"
          >
            <div className="flex items-center gap-2 border-b border-border/40 pb-2 text-xs font-semibold text-foreground">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              <span>Inference Telemetry</span>
            </div>

            <div className="mt-2.5 space-y-1.5 text-xs">
              {telemetry.provider && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Provider</span>
                  <span className="font-medium text-foreground font-mono text-[11px]">{telemetry.provider}</span>
                </div>
              )}
              {latencyStr && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Latency</span>
                  <span className="font-medium text-foreground font-mono text-[11px]">
                    {telemetry.latency_ms ? `${Math.round(telemetry.latency_ms)}ms` : latencyStr}
                  </span>
                </div>
              )}
              {telemetry.prompt_tokens !== undefined && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Prompt tokens</span>
                  <span className="font-medium text-foreground font-mono text-[11px]">{telemetry.prompt_tokens.toLocaleString()}</span>
                </div>
              )}
              {telemetry.completion_tokens !== undefined && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Completion tokens</span>
                  <span className="font-medium text-foreground font-mono text-[11px]">{telemetry.completion_tokens.toLocaleString()}</span>
                </div>
              )}
              {totalTokens > 0 && (
                <div className="flex items-center justify-between text-muted-foreground pt-1.5 border-t border-border/40 font-medium">
                  <span className="text-foreground">Total Tokens</span>
                  <span className="font-bold text-primary font-mono text-[11px]">{totalTokens.toLocaleString()}</span>
                </div>
              )}
              {telemetry.failover_count !== undefined && telemetry.failover_count > 0 && (
                <div className="flex items-center justify-between text-amber-500 text-[10px] pt-1">
                  <span>Auto-Failovers</span>
                  <span className="font-bold font-mono">{telemetry.failover_count}</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reasoning & Thought Disclosure Component
// ---------------------------------------------------------------------------
interface ReasoningDisclosureProps {
  isStreaming: boolean;
  graphStatuses?: any[];
  toolTrace?: string[];
  confidence?: number;
  telemetry?: MessageTelemetry;
  activeStepLabel?: string;
  hasRetrieval?: boolean;
}

export function ReasoningDisclosure({
  isStreaming,
  graphStatuses,
  toolTrace,
  confidence,
  telemetry,
  activeStepLabel,
  hasRetrieval,
}: ReasoningDisclosureProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const showConfidence = useStore((s) => s.showConfidence);

  // If streaming, render active shimmer loader (no box, no pill, clean 34px loader)
  if (isStreaming) {
    return (
      <div className="flex items-center gap-3.5 my-2.5 select-none w-fit">
        <KnowvexRadialLoader size={34} speed={1.25} />
        <div className="flex items-center min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStepLabel || "Thinking"}
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <Shimmer className="text-sm font-semibold tracking-tight">
                {activeStepLabel ? `${activeStepLabel}…` : "Thinking…"}
              </Shimmer>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  const steps = (graphStatuses && graphStatuses.length > 0)
    ? graphStatuses
    : (toolTrace && toolTrace.length > 0)
    ? toolTrace.map((node) => ({ node, label: node.replace(/_/g, " "), status: "completed" }))
    : [];

  const isRetrievalResponse = Boolean(
    hasRetrieval ||
    (toolTrace && toolTrace.some(t => /search|retriev|document|rag|web/i.test(t) && !/direct/i.test(t))) ||
    (graphStatuses && graphStatuses.some(s => /search|retriev|document|rag|web/i.test(s.node || s.label || "") && !/direct/i.test(s.node || s.label || ""))) ||
    (steps && steps.some((s: any) => (s.chunks_found && s.chunks_found > 0) || (s.results_found && s.results_found > 0)))
  );

  const shouldShowConfidence = Boolean(
    showConfidence &&
    isRetrievalResponse &&
    confidence !== undefined &&
    confidence !== null &&
    confidence > 0
  );

  if (steps.length === 0 && !shouldShowConfidence && (!toolTrace || toolTrace.length === 0)) {
    return null;
  }

  const stepCount = steps.length || (toolTrace ? toolTrace.length : 1);
  const summaryLabel = `Thought process (${stepCount} ${stepCount === 1 ? 'step' : 'steps'})`;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="inline-flex items-center gap-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none group"
        title={isExpanded ? "Collapse thought process" : "View thought process"}
      >
        <BrainCircuit className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
        <span>{summaryLabel}</span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-180 text-primary"
          )}
        />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden my-2"
          >
            <div className="space-y-1.5 py-1 text-xs text-muted-foreground">
              {shouldShowConfidence && (
                <div className="flex items-center gap-1.5 text-[11px] pb-0.5">
                  <span className="text-muted-foreground">Confidence:</span>
                  <span
                    className={cn(
                      "font-mono font-medium",
                      confidence! >= 0.8
                        ? "text-emerald-500"
                        : confidence! >= 0.5
                        ? "text-amber-500"
                        : "text-muted-foreground"
                    )}
                  >
                    {Math.round(confidence! <= 1 ? confidence! * 100 : confidence!)}%
                  </span>
                </div>
              )}

              {steps.map((step: any, sIdx: number) => {
                const isRunning = isStreaming && step.status === "running";
                const isFailed = step.status === "failed";
                const label = step.label || (step.node ? step.node.replace(/_/g, " ") : `Step ${sIdx + 1}`);

                return (
                  <div key={sIdx} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0">
                      {isRunning ? (
                        <Loader2 className="w-3 h-3 text-primary animate-spin" />
                      ) : isFailed ? (
                        <AlertCircle className="w-3 h-3 text-danger" />
                      ) : (
                        <Check className="w-3 h-3 text-emerald-500" />
                      )}
                    </span>

                    <span className="text-foreground/90 capitalize font-medium">
                      {label}
                    </span>

                    {step.chunks_found !== undefined && (
                      <span className="text-[11px] text-muted-foreground/70">
                        · {step.chunks_found} chunks retrieved
                      </span>
                    )}
                    {step.results_found !== undefined && (
                      <span className="text-[11px] text-muted-foreground/70">
                        · {step.results_found} web sources
                      </span>
                    )}
                    {step.routing_reason && (
                      <span className="text-[11px] text-muted-foreground/60 italic">
                        ({step.routing_reason})
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memoized Message Item Component (Historical Turns 1..N-1 Do Not Re-render)
// ---------------------------------------------------------------------------
interface MessageItemProps {
  msg: Message;
  index: number;
  isLastMessage: boolean;
  isStreaming: boolean;
  copiedId: string | null;
  feedbacks: Record<string, "up" | "down">;
  expandedSources: Record<string, boolean>;
  chatMode: "auto" | "research";
  onCopy: (id: string, text: string) => void;
  onFeedback: (id: string, type: "up" | "down") => void;
  onRetryMessage?: (messageId: string, mode?: "auto" | "research") => void;
  toggleMessageSources: (id: string) => void;
  setActiveCitation: (cite: any) => void;
  resolveCitationName: (cite: any) => string;
  visibleGraphStatuses: any[];
}

export const MessageItem = React.memo(function MessageItem({
  msg,
  index,
  isLastMessage,
  isStreaming,
  copiedId,
  feedbacks,
  expandedSources,
  chatMode,
  onCopy,
  onFeedback,
  onRetryMessage,
  toggleMessageSources,
  setActiveCitation,
  resolveCitationName,
  visibleGraphStatuses,
}: MessageItemProps) {
  // If assistant message has no text and is not streaming
  if (msg.sender === "assistant" && !msg.text && !isStreaming) {
    const hasFailed = msg.graphStatuses?.some((s: any) => s.status === "failed" || s.status === "error");
    if (hasFailed) {
      const failedMsg = msg.graphStatuses?.find((s: any) => s.status === "failed" || s.status === "error")?.message || "Stream interrupted. Please try again.";
      return (
        <div className="w-full flex flex-col my-2">
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground flex items-start gap-3 shadow-sm">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-destructive leading-relaxed">⚠️ {failedMsg}</p>
              {onRetryMessage && (
                <button
                  type="button"
                  onClick={() => onRetryMessage(msg.id, chatMode)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border/80 hover:bg-surface-container text-xs font-semibold text-foreground transition-colors cursor-pointer shadow-sm active:scale-95"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-primary" />
                  <span>Retry generation</span>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  if (msg.sender === "user") {
    return (
      <div className="w-full flex flex-col">
        <div className="flex flex-col items-end w-full">
          <div className="max-w-[85%] rounded-2xl bg-surface-container border border-border/80 px-4 py-3 text-sm text-foreground">
            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
          </div>
          <div className="flex items-center gap-1 mt-1 mr-1">
            <button
              type="button"
              onClick={() => onCopy(msg.id, msg.text)}
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              title="Copy message"
              aria-label="Copy user message"
            >
              {copiedId === msg.id ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Assistant message
  const activeStatuses = isStreaming && visibleGraphStatuses.length > 0 ? visibleGraphStatuses : (msg.graphStatuses || []);
  const activeStepLabel = isStreaming ? getActiveStepLabel(visibleGraphStatuses) : undefined;
  const formattedMarkdown = formatAssistantMarkdown(msg.text, msg.citations);

  return (
    <div className="w-full flex flex-col">
      <div className="w-full min-w-0">
        <div className="min-w-0 flex-1 flex flex-col space-y-2">
          {/* Reasoning & Thought Disclosure */}
          <ReasoningDisclosure
            isStreaming={isStreaming && !msg.text}
            graphStatuses={activeStatuses}
            toolTrace={msg.tool_trace}
            confidence={msg.confidence}
            telemetry={msg.telemetry}
            activeStepLabel={activeStepLabel}
            hasRetrieval={Boolean(
              (msg.citations && msg.citations.length > 0) ||
              (msg as any).used_vector_db ||
              (msg.tool_trace && msg.tool_trace.some(t => /search|retriev|document|rag|web/i.test(t) && !/direct/i.test(t))) ||
              (activeStatuses && activeStatuses.some(s => /search|retriev|document|rag|web/i.test(s.node || s.label || "") && !/direct/i.test(s.node || s.label || "")))
            )}
          />

          {/* Assistant markdown content */}
          <div className="max-w-none min-w-0 text-foreground">
            {msg.text && (
              msg.text.startsWith("⚠️") || msg.text.includes("Stream interrupted") ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground flex items-start gap-3 my-2 shadow-sm">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-destructive leading-relaxed">{msg.text}</p>
                    {onRetryMessage && (
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg.id, chatMode)}
                        className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface border border-border/80 hover:bg-surface-container text-xs font-semibold text-foreground transition-colors cursor-pointer shadow-sm active:scale-95"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-primary" />
                        <span>Retry generation</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                    a: ({ href, children }) => {
                      if (href?.startsWith("cite://")) {
                        const citeIndex = parseInt(href.replace("cite://", ""), 10);
                        const citation = msg.citations?.[citeIndex];
                        return (
                          <InlineCitation
                            citation={citation}
                            index={citeIndex}
                            label={children}
                            onSelect={(c) => {
                              const name = resolveCitationName(c);
                              setActiveCitation({ ...c, name });
                            }}
                          />
                        );
                      }
                      return (
                        <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-words">
                          {children}
                        </a>
                      );
                    },
                    p: ({ children }) => (
                      <p className="my-3.5 break-words text-sm leading-7 text-foreground">
                        {children}
                      </p>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mt-7 mb-3 text-lg font-bold tracking-tight text-foreground">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mt-5 mb-2 text-sm font-semibold tracking-tight text-foreground">
                        {children}
                      </h3>
                    ),
                    ul: ({ children }) => (
                      <ul className="my-3.5 list-disc space-y-1.5 pl-6 text-sm">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-3.5 list-decimal space-y-1.5 pl-6 text-sm">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="break-words pl-1 text-sm leading-6 text-foreground">
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold text-foreground">
                        {children}
                      </strong>
                    ),
                    code: ({ className, children, ...props }: any) => {
                      const code = String(children).replace(/\n$/, "");
                      const language = /language-(\w+)/.exec(className || "")?.[1];
                      const isBlock = Boolean(className) || code.includes("\n");
                      if (isBlock) {
                        return <CodeBlock code={code} language={language} />;
                      }
                      return (
                        <code className="rounded-md bg-surface-container border border-border px-1.5 py-0.5 text-xs font-mono font-medium text-foreground" {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => <>{children}</>,
                    table: ({ children }) => (
                      <div className="my-5 w-full overflow-x-auto rounded-xl border border-border/80 bg-surface/50 shadow-sm scrollbar-thin">
                        <table className="w-full min-w-[500px] border-collapse text-left text-xs md:text-sm">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="border-b border-border bg-surface-container/70 text-foreground font-semibold">
                        {children}
                      </thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-border/40 text-foreground/90 font-normal">
                        {children}
                      </tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="transition-colors hover:bg-surface-container/30 even:bg-surface/20">
                        {children}
                      </tr>
                    ),
                    th: ({ children }) => (
                      <th className="px-4 py-3 text-xs font-semibold tracking-wider text-foreground border-r border-border/40 last:border-r-0 whitespace-nowrap bg-surface-container/40">
                        {renderTableCellContent(children)}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="px-4 py-3 text-xs md:text-sm text-foreground/90 border-r border-border/30 last:border-r-0 align-top leading-relaxed break-words">
                        {renderTableCellContent(children)}
                      </td>
                    ),
                  }}
                >
                  {formattedMarkdown}
                </ReactMarkdown>
                {isStreaming && <span className="streaming-cursor">▋</span>}
              </>
            ))}
          </div>

          {/* Grounding Citations Drawer */}
          {msg.citations && msg.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <button
                type="button"
                onClick={() => toggleMessageSources(msg.id)}
                className={cn(
                  "inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 motion-reduce:transform-none",
                  expandedSources[msg.id]
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-surface hover:bg-surface-container text-muted-foreground hover:text-foreground border-border/70 hover:border-border"
                )}
                title={expandedSources[msg.id] ? "Collapse sources" : "View cited sources"}
              >
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span className="font-semibold text-foreground">
                  {msg.citations.length} {msg.citations.length === 1 ? "Source" : "Sources"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {expandedSources[msg.id] ? "Click to hide" : "Click to view"}
                </span>
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200 text-muted-foreground",
                    expandedSources[msg.id] && "rotate-180 text-primary"
                  )}
                />
              </button>

              <AnimatePresence>
                {expandedSources[msg.id] && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="flex flex-wrap gap-2 pt-2.5">
                      {msg.citations.map((cite: any, cIdx: number) => {
                        const isWeb = cite.type === "web";
                        const name = resolveCitationName(cite);
                        const pageNum = cite.page ?? cite.page_label ?? cite.page_number;
                        const badge = isWeb ? "Web" : pageNum != null ? `Page ${pageNum}` : "Doc";
                        return (
                          <button
                            key={cIdx}
                            type="button"
                            onClick={() => setActiveCitation({ ...cite, name })}
                            className="bg-surface border border-border hover:border-primary/40 hover:bg-surface-container px-2.5 py-1 rounded-md flex items-center space-x-2 transition-colors cursor-pointer text-left group active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 motion-reduce:transform-none"
                          >
                            {isWeb ? (
                              <Search className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                            ) : name.endsWith(".xlsx") || name.endsWith(".csv") ? (
                              <FileSpreadsheet className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                            ) : (
                              <FileText className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                            )}
                            <span className="text-xs font-medium text-foreground truncate max-w-[140px]">
                              {name}
                            </span>
                            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">
                              {badge}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Assistant Message Actions Toolbar */}
          {msg.text && (
            <div className="flex items-center space-x-1 mt-2">
              <button
                type="button"
                onClick={() => onCopy(msg.id, msg.text)}
                className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface rounded-md transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                title="Copy answer"
                aria-label="Copy assistant answer"
              >
                {copiedId === msg.id ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => onFeedback(msg.id, 'up')}
                className={cn(
                  "p-1.5 rounded-md transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
                  feedbacks[msg.id] === 'up' ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
                title="Accurate response"
                aria-label="Mark accurate response"
              >
                <ThumbsUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onFeedback(msg.id, 'down')}
                className={cn(
                  "p-1.5 rounded-md transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
                  feedbacks[msg.id] === 'down' ? "text-danger bg-danger-subtle" : "text-muted-foreground hover:text-foreground hover:bg-surface"
                )}
                title="Needs improvement"
                aria-label="Mark response needs improvement"
              >
                <ThumbsDown className="w-4 h-4" />
              </button>
              {onRetryMessage && (
                <button
                  type="button"
                  onClick={() => onRetryMessage(msg.id, chatMode)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  title="Regenerate response"
                  aria-label="Regenerate response"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}

              {/* Context / Telemetry Badge with HoverCard breakdown */}
              <TelemetryBadge telemetry={msg.telemetry} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, areMessagePropsEqual);

function areMessagePropsEqual(prev: MessageItemProps, next: MessageItemProps): boolean {
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.isLastMessage !== next.isLastMessage) return false;

  if (next.isStreaming) {
    if (prev.msg.text !== next.msg.text) return false;
    if (prev.visibleGraphStatuses !== next.visibleGraphStatuses) return false;
  }

  if (prev.msg !== next.msg) return false;

  const msgId = next.msg.id;
  if ((prev.copiedId === msgId) !== (next.copiedId === msgId)) return false;
  if (prev.feedbacks[msgId] !== next.feedbacks[msgId]) return false;
  if (Boolean(prev.expandedSources[msgId]) !== Boolean(next.expandedSources[msgId])) return false;
  if (prev.chatMode !== next.chatMode) return false;

  return true;
}

interface ChatWorkspaceProps {
  messages: Message[];
  isProcessing: boolean;
  onSendMessage: (text: string, mode?: "auto" | "research") => void;
  documents: SourceDocument[];
  allDocuments?: SourceDocument[];
  activeConvId?: string;
  onAddDocument: (file: File) => void;
  onLinkDocument?: (documentId: string) => void;
  onUnlinkDocument?: (documentId: string) => void;
  onRetryMessage?: (messageId: string, mode?: "auto" | "research") => void;
  selectedModel: string;
  sessionTitle?: string;
  graphStatuses?: any[];
}

export default function ChatWorkspace({
  messages,
  isProcessing,
  onSendMessage,
  documents,
  allDocuments = EMPTY_DOCS,
  activeConvId,
  onAddDocument,
  onLinkDocument,
  onUnlinkDocument,
  onRetryMessage,
  selectedModel,
  sessionTitle = "New Research Session",
  graphStatuses = [],
}: ChatWorkspaceProps) {
  const logoVariant = useStore((s) => s.logoVariant);
  const [inputText, setInputText] = useState("");
  const [promptAttachments, setPromptAttachments] = useState<SourceDocument[]>([]);
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  const [copiedCitation, setCopiedCitation] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [chatMode, setChatMode] = useState<"auto" | "research">("auto");
  const [isLinkDropdownOpen, setIsLinkDropdownOpen] = useState(false);
  
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbacks, setFeedbacks] = useState<Record<string, 'up' | 'down'>>({});
  const [activeFeedbackMsg, setActiveFeedbackMsg] = useState<{ id: string; dbId: number; rating: number; type: 'up' | 'down' } | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const toggleMessageSources = useCallback((msgId: string) => {
    setExpandedSources((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  }, []);

  const resolveCitationName = useCallback((cite: any): string => {
    if (cite.type === "web") return cite.title || cite.url || "Web Source";
    const rawName = cite.name || cite.title || "";
    if (/^[a-f0-9]{20,}\./i.test(rawName)) {
      const doc = documents.find((d) => d.id === cite.id || rawName.includes(d.id)) || (documents.length === 1 ? documents[0] : null);
      if (doc?.name) return doc.name;
      const allDoc = allDocuments.find((d) => d.id === cite.id || rawName.includes(d.id));
      if (allDoc?.name) return allDoc.name;
    }
    return rawName || "Document";
  }, [documents, allDocuments]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const visibleGraphStatuses = graphStatuses.length > 0
    ? graphStatuses.reduce((items: any[], status: any) => {
        const key = status.node || status.label || status.message;
        const existingIdx = items.findIndex((item) => (item.node || item.label || item.message) === key);
        if (existingIdx === -1) return [...items, status];
        return items.map((item, idx) => idx === existingIdx ? { ...item, ...status } : item);
      }, [])
    : STARTING_GRAPH_STATUS;

  const handleChatScroll = () => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const isNearBottom = distanceFromBottom < 140;
    shouldStickToBottomRef.current = isNearBottom;
    setShowJumpToLatest(!isNearBottom);
  };

  const scrollToLatest = () => {
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      if (isProcessing) {
        scrollRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      } else {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        });
      }
      setShowJumpToLatest(false);
    } else {
      setShowJumpToLatest(true);
    }
  }, [messages, isProcessing, graphStatuses]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText.trim(), chatMode);
    setInputText("");
    setPromptAttachments([]);
  };

  const fallbackCopyText = (id: string, text: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1000);
      }
    } catch (err) {
      console.error("Fallback copy failed: ", err);
    }
    document.body.removeChild(textArea);
  };

  const handleCopy = useCallback((id: string, text: string) => {
    const cleaned = cleanMessageText(text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cleaned)
        .then(() => {
          setCopiedId(id);
          setTimeout(() => setCopiedId(null), 1000);
        })
        .catch(() => {
          fallbackCopyText(id, cleaned);
        });
    } else {
      fallbackCopyText(id, cleaned);
    }
  }, []);

  const handleFeedback = useCallback((id: string, type: 'up' | 'down') => {
    const msg = messagesRef.current.find(m => m.id === id);
    if (!msg) return;
    if (!msg.dbId) {
      return;
    }
    setActiveFeedbackMsg({
      id: msg.id,
      dbId: msg.dbId,
      rating: type === 'up' ? 5 : 2,
      type
    });
  }, []);

  const handleFeedbackSubmit = async (rating: number, comment: string) => {
    if (!activeFeedbackMsg) return;
    const msgIndex = messages.findIndex(m => m.id === activeFeedbackMsg.id);
    const prevMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
    const queryText = prevMsg?.text || "Workspace query";
    const answerText = messages.find(m => m.id === activeFeedbackMsg.id)?.text || "";

    try {
      await api.submitFeedback({
        message_id: activeFeedbackMsg.dbId,
        query: queryText,
        answer: answerText,
        rating,
        comment,
        confidence: 0.9,
        tool_used: "RAG Pipeline"
      });
      setFeedbacks(prev => ({ ...prev, [activeFeedbackMsg.id]: activeFeedbackMsg.type }));
    } catch (err) {
      console.error("Failed to submit feedback", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDirectAttachFile = (file: File) => {
    if (file.size === 0) {
      toast.error(`Upload failed: File ${file.name} is empty.`);
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast.error(`Upload failed: File size for ${file.name} exceeds the 30 MB limit.`);
      return;
    }
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    const allowed = ['.pdf', '.txt', '.md', '.docx'];
    if (file.name.includes('.') && !allowed.includes(ext)) {
      toast.error(`Upload failed: Unsupported file extension '${ext}'. Allowed extensions: ${allowed.join(', ')}`);
      return;
    }
    onAddDocument(file);
    const tempAttachment: SourceDocument = {
      id: `prompt-attach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${file.name}`,
      name: file.name,
      size: `${(file.size / 1024).toFixed(0)} KB`,
      type: ext === '.csv' || ext === '.xlsx' ? 'spreadsheet' : 'pdf',
      addedAt: 'Just now',
      chunks: 0,
      active: true,
    };
    setPromptAttachments((prev) => [...prev, tempAttachment]);
  };

  const handleRemovePromptAttachment = (docId: string) => {
    // Only dismisses the chip from the current prompt input
    // Does NOT delete or unlink the document from the session document list
    setPromptAttachments((prev) => prev.filter((d) => d.id !== docId));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => handleDirectAttachFile(file));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleStop = () => {
    if (activeConvId) {
      const stream = useStore.getState().streamingSessions[activeConvId];
      if (stream?.abortController) {
        stream.abortController.abort();
      }
      useStore.getState().setSessionStream(activeConvId, null);
    }
  };

  return (
    <div className="flex-1 flex w-full h-full overflow-hidden relative bg-background">
      
      {/* Main Chat Workstation Stage */}
      <div
        className={cn(
          "flex flex-col min-w-0 min-h-0 relative",
          isInspectorOpen ? "w-[calc(100%-20rem)] md:w-[calc(100%-24rem)] shrink-0" : "flex-1"
        )}
      >
        {/* Workstation Top Navigation Bar */}
        <header className="h-14 shrink-0 flex justify-between items-center px-6 bg-background border-b border-border z-20">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-foreground tracking-tight truncate max-w-[280px] sm:max-w-md">
              {sessionTitle}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-container border border-border text-xs text-muted-foreground shrink-0">
              <Paperclip className="w-3 h-3" />
              <span>{documents.length} sources in context</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsInspectorOpen(!isInspectorOpen)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold border active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transform-none",
                isInspectorOpen 
                  ? "bg-surface-container border-border text-foreground" 
                  : "bg-surface border-border/70 text-muted-foreground hover:text-foreground hover:border-border"
              )}
              title={isInspectorOpen ? "Close source inspector" : "Open source inspector"}
              aria-label={isInspectorOpen ? "Close source inspector" : "Open source inspector"}
            >
              <span>Inspector</span>
              {isInspectorOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            </button>
          </div>
        </header>

        {/* Chat Feed */}
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-10 pt-6 pb-4 flex flex-col items-center min-h-0 [overflow-anchor:auto]"
          style={{ overflowAnchor: "auto" }}
        >
          <div className={cn("w-full min-w-0 space-y-10", isInspectorOpen ? "max-w-3xl" : "max-w-4xl")}>
            
            {messages.length === 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 8 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ duration: 0.3 }}
                className="select-none my-8 text-center flex flex-col items-center w-full"
              >
                <div className="w-12 h-12 rounded-xl bg-surface-container border border-border flex items-center justify-center mb-4 shadow-sm">
                  <BrandLogo size={28} showWordmark={false} />
                </div>
                <h2 className="text-xl font-bold text-foreground tracking-tight mb-1.5">
                  KnowVex Research Workstation
                </h2>
                <p className="text-muted-foreground text-xs max-w-md text-center mb-8 leading-relaxed">
                  Query your indexed documents, synthesize evidence, and execute multi-hop RAG retrievals.
                </p>

                {/* Technical Workstation Prompt Launchers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-xl">
                  {[
                    {
                      title: "Summarize active context",
                      desc: "Extract key findings and generate an executive brief",
                      prompt: "Please write a comprehensive executive summary of the primary topics and key findings in the active documents.",
                      icon: FileText,
                    },
                    {
                      title: "Verify grounding claims",
                      desc: "Cross-reference facts against cited source passages",
                      prompt: "Identify the critical evidence in the indexed documents that supports the following claim: ",
                      icon: Search,
                    },
                    {
                      title: "Compare source materials",
                      desc: "Extract side-by-side contrasts between indexed files",
                      prompt: "Compare the core methodologies and identify any contrasting points between the active documents.",
                      icon: Layers,
                    },
                    {
                      title: "Draft verification script",
                      desc: "Generate verification logic based on retrieved rules",
                      prompt: "Write a python script to run verification assertions on retrieved RAG contexts.",
                      icon: Settings2,
                    }
                  ].map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setInputText(item.prompt)}
                      className="flex items-start p-3.5 rounded-xl border border-border bg-surface-container-lowest hover:border-primary/40 hover:bg-surface-container/60 transition-colors duration-150 text-left group cursor-pointer active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transform-none"
                    >
                      <div className="w-7 h-7 rounded-lg bg-surface-container border border-border flex items-center justify-center shrink-0 mr-3 text-muted-foreground group-hover:text-foreground transition-colors">
                        <item.icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xs font-semibold text-foreground truncate">{item.title}</h3>
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{item.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Conversation Flow */}
            <div className="space-y-8">
              {messages.map((msg, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = isProcessing && isLastMessage && msg.sender === "assistant";

                return (
                  <MessageItem
                    key={msg.id}
                    msg={msg}
                    index={index}
                    isLastMessage={isLastMessage}
                    isStreaming={isStreaming}
                    copiedId={copiedId}
                    feedbacks={feedbacks}
                    expandedSources={expandedSources}
                    chatMode={chatMode}
                    onCopy={handleCopy}
                    onFeedback={handleFeedback}
                    onRetryMessage={onRetryMessage}
                    toggleMessageSources={toggleMessageSources}
                    setActiveCitation={setActiveCitation}
                    resolveCitationName={resolveCitationName}
                    visibleGraphStatuses={visibleGraphStatuses}
                  />
                );
              })}

              {/* Active AI Processing Indicator with Shimmer Step if no assistant message is yet in state */}
              {isProcessing && (!messages.length || messages[messages.length - 1].sender === "user") && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3.5 my-3 select-none"
                >
                  <KnowvexRadialLoader size={34} speed={1.25} />
                  <div className="flex items-center min-w-0">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={getActiveStepLabel(visibleGraphStatuses)}
                        initial={{ opacity: 0, x: 4 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -4 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                      >
                        <Shimmer className="text-sm font-semibold tracking-tight">
                          {`${getActiveStepLabel(visibleGraphStatuses)}…`}
                        </Shimmer>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
              
              <div ref={scrollRef} />
            </div>
          </div>
        </div>

        {/* Jump to Latest Floating Button */}
        <AnimatePresence>
          {showJumpToLatest && (
            <motion.button
              type="button"
              onClick={scrollToLatest}
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute bottom-[140px] left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-surface-container-lowest p-2 text-foreground shadow-sm transition-colors hover:bg-surface-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95 disabled:opacity-50 disabled:pointer-events-none motion-reduce:transform-none"
              title="Jump to latest message"
              aria-label="Jump to latest message"
            >
              <ArrowDown className="h-4 w-4" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Docked Command Composer Dock */}
        <div className="shrink-0 px-4 md:px-10 pb-5 pt-2 flex justify-center relative z-30">
          <div className={cn(
            "w-full relative z-10",
            isInspectorOpen ? "max-w-3xl" : "max-w-4xl"
          )}>
            <PromptInput
              value={inputText}
              onChange={setInputText}
              onSubmit={handleSubmit}
              isProcessing={isProcessing}
              onStop={handleStop}
              chatMode={chatMode}
              onChatModeChange={setChatMode}
              onAttachFile={handleDirectAttachFile}
              attachedDocuments={promptAttachments}
              onRemoveAttachment={handleRemovePromptAttachment}
              placeholder="Ask anything or research your documents…"
              minHeight={46}
              maxHeight={180}
            />
          </div>
        </div>
      </div>

      {/* Right Workstation Inspector Panel */}
      <AnimatePresence>
        {isInspectorOpen && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", stiffness: 350, damping: 32 }}
            className="absolute right-0 top-0 bottom-0 w-80 md:w-96 border-l border-border bg-background z-40 flex flex-col"
          >
            <div className="h-14 border-b border-border flex items-center px-4 bg-surface-container-lowest shrink-0">
              <h3 className="font-semibold text-xs text-foreground flex items-center">
                <BrainCircuit className="w-4 h-4 mr-2 text-primary" />
                Knowledge Context Inspector
              </h3>
              <button 
                type="button"
                onClick={() => setIsInspectorOpen(false)}
                className="ml-auto p-1.5 hover:bg-surface rounded-md text-muted-foreground hover:text-foreground transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                title="Close inspector"
                aria-label="Close inspector"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Add Sources Section */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2.5">Add Sources to Context</h4>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center p-3 rounded-xl border border-border bg-surface-container-lowest hover:border-primary/40 hover:bg-surface-container transition-colors duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 group motion-reduce:transform-none"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-1.5">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-medium text-foreground">Upload File</span>
                  </button>
                  
                  {allDocuments.length > 0 && onLinkDocument ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsLinkDropdownOpen(!isLinkDropdownOpen)}
                        className="w-full flex flex-col items-center justify-center p-3 border border-border bg-surface-container-lowest hover:border-primary/40 hover:bg-surface-container rounded-xl transition-colors duration-150 active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 group motion-reduce:transform-none"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-1.5">
                          <Paperclip className="w-4 h-4" />
                        </div>
                        <span className="text-xs font-medium text-foreground">Link Existing</span>
                      </button>
                      
                      <AnimatePresence>
                        {isLinkDropdownOpen && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsLinkDropdownOpen(false)} />
                            <motion.div
                              initial={{ opacity: 0, y: 4, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, y: 4, scale: 0.98 }}
                              transition={{ duration: 0.14, ease: "easeOut" }}
                              className="absolute top-full left-0 right-0 mt-1.5 p-1 bg-surface-container-lowest border border-border rounded-xl shadow-md z-50 max-h-48 overflow-y-auto"
                            >
                              {allDocuments.reduce<React.ReactNode[]>((acc, d) => {
                                if (!documents.find(sd => sd.id === d.id)) {
                                  acc.push(
                                    <button
                                      key={d.id}
                                      type="button"
                                      onClick={() => {
                                        onLinkDocument(d.id);
                                        setIsLinkDropdownOpen(false);
                                      }}
                                      className="w-full text-left px-2.5 py-2 text-xs font-medium text-foreground hover:bg-surface hover:text-primary rounded-lg transition-colors truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                                    >
                                      {d.name}
                                    </button>
                                  );
                                }
                                return acc;
                              }, [])}
                              {allDocuments.every(d => documents.some(sd => sd.id === d.id)) && (
                                <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                                  All indexed documents linked
                                </div>
                              )}
                            </motion.div>
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center p-3 rounded-xl border border-border bg-surface-container-lowest opacity-50 cursor-not-allowed">
                      <div className="w-8 h-8 rounded-full bg-surface-container text-muted-foreground flex items-center justify-center mb-1.5">
                        <Paperclip className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">Link Existing</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Documents Section */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="text-xs font-semibold text-muted-foreground">Active Documents ({documents.length})</h4>
                </div>
                
                {documents.length === 0 ? (
                  <div className="text-center p-5 bg-surface border border-dashed border-border rounded-xl">
                    <Database className="w-6 h-6 text-muted-foreground opacity-40 mx-auto mb-1.5" />
                    <p className="text-xs text-muted-foreground">No documents in context.</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">Upload or link sources above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {documents.map((doc, i) => {
                      const isProcessingDoc = doc.status === "queued" || doc.status === "indexing";
                      const isFailed = doc.status === "failed";
                      const isIndexed = doc.status === "indexed" || !doc.status;
                      
                      return (
                        <div key={i} className={cn("p-2.5 bg-surface-container-lowest border border-border rounded-lg flex items-start space-x-2.5 relative overflow-hidden", isProcessingDoc ? "opacity-80" : "")}>
                          {isProcessingDoc ? (
                            <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0 mt-0.5 motion-reduce:animate-none" />
                          ) : isFailed ? (
                            <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1 min-w-0">
                            <h5 className="text-xs font-semibold text-foreground truncate">{doc.name}</h5>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              Status: {isProcessingDoc ? "Indexing…" : isFailed ? "Failed" : "Indexed"} · Size: {doc.size || (doc as any).file_size_kb + " KB"}
                            </p>
                          </div>
                          {onUnlinkDocument && (
                            <button
                              type="button"
                              onClick={() => onUnlinkDocument(doc.id)}
                              className="p-1 hover:bg-surface-container text-muted-foreground hover:text-foreground rounded-md transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                              title="Unlink document"
                              aria-label="Unlink document"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isProcessingDoc && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-surface-container-high overflow-hidden">
                              <motion.div 
                                className="h-full bg-primary" 
                                initial={{ x: "-100%" }}
                                animate={{ x: "100%" }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
        accept=".pdf,.txt,.md,.docx"
        multiple
      />

      {/* Citation Detail Modal */}
      <AnimatePresence>
        {activeCitation && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.96 }} 
              animate={{ scale: 1 }} 
              exit={{ scale: 0.96 }}
              className="bg-surface-container-lowest max-w-xl w-full rounded-2xl p-6 border border-border shadow-lg space-y-4"
            >
              <div className="flex items-center justify-between border-b border-border pb-3.5">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-surface rounded-md border border-border text-foreground">
                    {activeCitation.type === 'web' ? <Search className="w-4 h-4 text-muted-foreground" /> : <FileText className="w-4 h-4 text-muted-foreground" />}
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground text-sm tracking-tight truncate max-w-[320px]">
                      {activeCitation.name || activeCitation.title || "Grounding Source"}
                    </h4>
                    {(() => {
                      const pageNum = activeCitation.page ?? activeCitation.page_label ?? activeCitation.page_number;
                      return pageNum != null ? (
                        <p className="text-[11px] text-muted-foreground mt-0.5">Page {pageNum}</p>
                      ) : null;
                    })()}
                  </div>
                </div>
                {activeCitation.fitScore != null && (
                  <span className="text-[11px] font-semibold text-foreground bg-surface px-2 py-1 rounded-md border border-border">
                    {activeCitation.fitScore}% Match
                  </span>
                )}
              </div>
              
              {(() => {
                const rawText = activeCitation.snippet || activeCitation.excerpt || activeCitation.text || "";
                const cleanExcerpt = rawText
                  ? rawText
                      .replace(/\s+/g, " ")
                      .replace(/(\b[a-zA-Z]+)-\s+([a-zA-Z]+\b)/g, "$1$2")
                      .trim()
                  : "No excerpt available for this citation.";

                const handleCopyCitation = () => {
                  navigator.clipboard?.writeText(cleanExcerpt).then(() => {
                    setCopiedCitation(true);
                    toast.success("Citation excerpt copied to clipboard");
                    setTimeout(() => setCopiedCitation(false), 1500);
                  });
                };

                return (
                  <>
                    <div className="relative bg-surface/80 rounded-xl p-4 border border-border/80 border-l-4 border-l-primary/70 shadow-xs max-h-72 overflow-y-auto">
                      {activeCitation.type === 'web' ? (
                        <div className="space-y-2.5">
                          <p className="text-xs sm:text-sm text-foreground/90 font-sans leading-relaxed">
                            {cleanExcerpt}
                          </p>
                          <a 
                            href={activeCitation.url} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline underline-offset-2 break-all font-medium pt-1"
                          >
                            <span>Visit source website</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary/80 uppercase tracking-wider font-sans">
                            <Quote className="w-3.5 h-3.5 text-primary" />
                            <span>Grounded Passage</span>
                          </div>
                          <blockquote className="text-xs sm:text-sm text-foreground/90 font-sans leading-relaxed italic">
                            "{cleanExcerpt}"
                          </blockquote>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={handleCopyCitation}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border hover:bg-surface-container text-muted-foreground hover:text-foreground rounded-lg font-medium text-xs cursor-pointer transition-colors active:scale-95"
                      >
                        {copiedCitation ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy Excerpt</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveCitation(null)}
                        className="px-4 py-2 bg-surface border border-border hover:bg-surface-container text-foreground rounded-lg font-medium text-xs cursor-pointer transition-colors active:scale-95 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 shadow-xs motion-reduce:transform-none"
                      >
                        Close
                      </button>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <FeedbackDialog
        isOpen={!!activeFeedbackMsg}
        onClose={() => setActiveFeedbackMsg(null)}
        onSubmit={handleFeedbackSubmit}
        defaultRating={activeFeedbackMsg?.rating || 5}
      />
    </div>
  );
}
