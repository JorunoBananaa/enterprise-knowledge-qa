import type { DataNode } from "antd/es/tree";

export interface LLMConfigBrief {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  is_active: boolean;
}

export interface ChatMessageOut {
  id: number;
  client_id?: string;
  session_id?: number;
  question: string;
  answer: string;
  result_status: string;
  created_at: string;
  citations?: CitationItem[];
}

export interface SessionItem {
  id: number;
  title: string | null;
  created_at: string;
  message_count: number;
}

export interface SessionDetail extends SessionItem {
  messages: ChatMessageOut[];
}

export interface CitationItem {
  id?: number | null;
  document_id: number;
  document_title?: string | null;
  document_name?: string | null;
  document_file_type?: string | null;
  document_storage_path?: string | null;
  document_path?: string | null;
  document_category_id?: number | null;
  chunk_id: number;
  locator: string;
  quoted_text_preview?: string | null;
  rank?: number | null;
}

export interface SourceSummary {
  key: string;
  name: string;
  documentId: number;
  fileType?: string | null;
  document_path?: string | null;
  categoryId?: number | null;
  citations: CitationItem[];
}

export interface CategoryItem {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface DocumentItem {
  id: number;
  title: string;
}

export interface CatTreeNode extends DataNode {
  categoryId: number;
  parentId: number | null;
  _children?: CatTreeNode[];
}
