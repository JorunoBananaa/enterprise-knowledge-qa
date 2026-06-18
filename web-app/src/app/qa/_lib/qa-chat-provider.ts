import {
  AbstractChatProvider,
  XRequest,
} from "@ant-design/x-sdk";
import type {
  SSEOutput,
  TransformMessage,
  XRequestOptions,
} from "@ant-design/x-sdk";
import {
  apiStreamFetch,
  buildStreamApiUrl,
  type StreamEvent,
} from "@/lib/api";
import type { ChatMessageOut, CitationItem } from "../_types";
import { INSUFFICIENT_EVIDENCE_ANSWER } from "./constants";

export interface QAAskInput {
  question: string;
  session_id: number | null;
  llm_config_id: number | null;
  category_ids: number[] | null;
  document_ids: number[] | null;
}

type QAChatOutput = SSEOutput;

function normalizeOptionalIds(ids?: number[] | null): number[] | null {
  return ids && ids.length > 0 ? ids : null;
}

function parseStreamEvent(chunk?: QAChatOutput): StreamEvent | null {
  if (!chunk?.event || typeof chunk.data !== "string") {
    return null;
  }

  try {
    const data = JSON.parse(chunk.data) as Record<string, unknown>;
    return { type: chunk.event, ...data } as StreamEvent;
  } catch {
    return null;
  }
}

function toCitationItem(event: Extract<StreamEvent, { type: "citation" }>) {
  const { type: _type, ...citation } = event;
  return citation as CitationItem;
}

export function createPendingQAChatMessage(question: string): ChatMessageOut {
  return {
    id: -Date.now(),
    question,
    answer: "",
    result_status: "streaming",
    created_at: new Date().toISOString(),
    citations: [],
  };
}

export class QAChatProvider extends AbstractChatProvider<
  ChatMessageOut,
  QAAskInput,
  QAChatOutput
> {
  private currentQuestion = "";

  transformParams(
    requestParams: Partial<QAAskInput>,
    options: XRequestOptions<QAAskInput, QAChatOutput, ChatMessageOut>,
  ): QAAskInput {
    const params = {
      ...(options.params || {}),
      ...requestParams,
    };
    const question = params.question?.trim() || "";

    this.currentQuestion = question;

    return {
      question,
      session_id: params.session_id ?? null,
      llm_config_id: params.llm_config_id ?? null,
      category_ids: normalizeOptionalIds(params.category_ids),
      document_ids: normalizeOptionalIds(params.document_ids),
    };
  }

  transformLocalMessage(): ChatMessageOut[] {
    return [];
  }

  transformMessage(
    info: TransformMessage<ChatMessageOut, QAChatOutput>,
  ): ChatMessageOut {
    const current =
      info.originMessage || createPendingQAChatMessage(this.currentQuestion);
    const event = parseStreamEvent(info.chunk);

    if (!event) {
      return current;
    }

    switch (event.type) {
      case "chunk":
        return {
          ...current,
          answer: `${current.answer}${event.text}`,
        };

      case "citation":
        return {
          ...current,
          citations: [...(current.citations || []), toCitationItem(event)],
        };

      case "done":
        return {
          ...current,
          id: event.message_id ?? current.id,
          session_id: event.session_id,
          answer:
            current.answer ||
            (event.status === "insufficient_evidence"
              ? INSUFFICIENT_EVIDENCE_ANSWER
              : ""),
          result_status: event.status,
        };

      case "error":
        throw new Error(event.message || "获取答案失败");
    }
  }
}

export function createQAChatProvider(): QAChatProvider {
  return new QAChatProvider({
    request: XRequest<QAAskInput, QAChatOutput, ChatMessageOut>(
      buildStreamApiUrl("/qa/ask/stream"),
      {
        manual: true,
        fetch: apiStreamFetch,
      },
    ),
  });
}
