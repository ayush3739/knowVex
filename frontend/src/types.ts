export type DocType = "pdf" | "spreadsheet" | "doc" | "link";

export interface SourceDocument {
  id: string;
  name: string;
  type: DocType;
  content?: string;
  addedAt?: string;
  size: string;
  active: boolean;
  status?: "queued" | "indexing" | "indexed" | "failed";
  summary?: string;
  chunkCount?: number;
  embeddingModel?: string;
  chunks?: any;
}

export interface Citation {
  name: string;
  fitScore: number | null;
  snippet: string;
  type?: string;
  title?: string;
  page?: number;
  page_label?: number | string;
  page_number?: number;
  excerpt?: string;
  text?: string;
  source?: string;
  chunk_id?: string;
  url?: string;
}

export interface MessageTelemetry {
  provider?: string;
  task?: string;
  failover_count?: number;
  latency_ms?: number;
  latency?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: any;
}

export interface Message {
  id: string;
  dbId?: number;
  sender: "user" | "assistant";
  text: string;
  timestamp: string;
  citations?: Citation[];
  chunks?: unknown;
  isProcessing?: boolean;
  graphStatuses?: any[];
  tool_trace?: string[];
  confidence?: number;
  telemetry?: MessageTelemetry;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  timestamp: string;
  documentCount?: number;
  attachedDocIds?: string[];
}

export interface ModelParams {
  temperature: number;
  tokenEfficiency: number;
  systemInstruction: string;
  selectedModel: string;
}

export interface UserQuota {
  role: string;
  queries_used: number;
  query_limit: number | null;
  queries_remaining: number | null;
  research_used?: number;
  research_limit?: number | null;
  research_remaining?: number | null;
  reset_at: string;
}

