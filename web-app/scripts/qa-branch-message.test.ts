import assert from "node:assert/strict";
import { canForkChatMessage } from "../src/app/qa/_lib/message-utils";
import type { ChatMessageOut } from "../src/app/qa/_types";

function createMessage(overrides: Partial<ChatMessageOut> = {}): ChatMessageOut {
  return {
    id: 42,
    question: "报销标准是什么？",
    answer: "按制度执行。",
    result_status: "answered",
    created_at: "2026-06-18T00:00:00.000Z",
    citations: [],
    ...overrides,
  };
}

assert.equal(canForkChatMessage(createMessage()), true);
assert.equal(canForkChatMessage(createMessage({ result_status: "insufficient_evidence" })), true);
assert.equal(canForkChatMessage(createMessage({ id: -1 })), false);
assert.equal(canForkChatMessage(createMessage({ result_status: "streaming" })), false);
assert.equal(canForkChatMessage(createMessage({ result_status: "aborted" })), false);
assert.equal(canForkChatMessage(createMessage({ result_status: "error" })), false);
