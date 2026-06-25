/**
 * 通用工具函数 —— 基于 lodash 子路径导入，避免拉入 lodash barrel。
 */
import _debounce from "lodash/debounce";
import _throttle from "lodash/throttle";
import _omit from "lodash/omit";

// ── 防抖 / 节流 ──────────────────────────────────────────────

export { _debounce as debounce, _throttle as throttle };

// ── 对象操作 ─────────────────────────────────────────────────

/** 从对象中排除指定字段返回新对象 */
export const omit = _omit;

// ── 字符串工具 ───────────────────────────────────────────────

/** 脱敏展示：只保留前 head 位和后 tail 位 */
export function maskString(
  str: string,
  head = 3,
  tail = 3,
  mask = "****",
): string {
  if (!str || str.length <= head + tail) return mask;
  return str.slice(0, head) + mask + str.slice(-tail);
}
