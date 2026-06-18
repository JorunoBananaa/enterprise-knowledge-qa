import type { ChatMessageOut, CitationItem, SourceSummary } from "../_types";
import { INSUFFICIENT_EVIDENCE_ANSWER } from "./constants";

export function normalizeMessageAnswer(
  message: ChatMessageOut,
): ChatMessageOut {
  if (
    message.result_status === "insufficient_evidence" &&
    !message.answer.trim()
  ) {
    return {
      ...message,
      answer: INSUFFICIENT_EVIDENCE_ANSWER,
    };
  }

  return message;
}

export function getChatMessageRenderKey({
  id,
  message,
}: {
  id: string | number;
  message: ChatMessageOut;
}): string | number {
  return message.client_id || id;
}

export function shouldRenderAssistantAnswer(message: ChatMessageOut): boolean {
  return (
    message.answer.trim().length > 0 || message.result_status !== "aborted"
  );
}

function getCitationDocumentName(citation: CitationItem): string {
  return (
    citation.document_name?.trim() ||
    citation.document_title?.trim() ||
    `文档 ${citation.document_id}`
  );
}

export function buildSourceSummaries(
  citations: CitationItem[] = [],
): SourceSummary[] {
  const sourceMap = new Map<string, SourceSummary>();

  for (const citation of citations) {
    const key = String(citation.document_id);
    const current = sourceMap.get(key);
    if (current) {
      current.citations.push(citation);
      continue;
    }

    sourceMap.set(key, {
      key,
      name: getCitationDocumentName(citation),
      documentId: citation.document_id,
      fileType: citation.document_file_type,
      document_path: citation.document_path,
      categoryId: citation.document_category_id,
      citations: [citation],
    });
  }

  return Array.from(sourceMap.values());
}
