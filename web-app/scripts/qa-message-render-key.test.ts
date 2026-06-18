import assert from "node:assert/strict";
import { getChatMessageRenderKey } from "../src/app/qa/_lib/message-utils";
import type { ChatMessageOut } from "../src/app/qa/_types";

function createMessage(overrides: Partial<ChatMessageOut> = {}): ChatMessageOut {
  return {
    id: -1700000000000,
    question: "什么是知识库问答？",
    answer: "",
    result_status: "streaming",
    created_at: "2026-06-18T00:00:00.000Z",
    citations: [],
    ...overrides,
  };
}

const streamingInfo = {
  id: "msg_0",
  message: createMessage({
    client_id: "request-1",
  }),
};
const firstChunkInfo = {
  id: "msg_1",
  message: createMessage({
    client_id: "request-1",
    answer: "知识库",
  }),
};
const completedInfo = {
  id: firstChunkInfo.id,
  message: createMessage({
    client_id: "request-1",
    id: 42,
    answer: "知识库问答会基于文档检索后生成答案。",
    result_status: "success",
  }),
};

assert.equal(
  getChatMessageRenderKey(streamingInfo),
  getChatMessageRenderKey(firstChunkInfo),
  "React key should stay stable when the loading placeholder is replaced by the first stream chunk",
);
assert.equal(
  getChatMessageRenderKey(firstChunkInfo),
  getChatMessageRenderKey(completedInfo),
  "React key should stay stable when backend message id arrives at stream completion",
);
assert.equal(getChatMessageRenderKey(completedInfo), "request-1");
