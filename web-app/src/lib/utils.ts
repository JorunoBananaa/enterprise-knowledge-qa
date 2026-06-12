/**
 * 通用工具函数 —— 基于 lodash 封装
 */
import {
  debounce as _debounce,
  throttle as _throttle,
  omit as _omit,
  pick as _pick,
  isEqual as _isEqual,
  cloneDeep as _cloneDeep,
  uniqBy as _uniqBy,
  groupBy as _groupBy,
  sortBy as _sortBy,
} from "lodash";

// ── 防抖 / 节流 ──────────────────────────────────────────────

export { _debounce as debounce, _throttle as throttle };

// ── 对象操作 ─────────────────────────────────────────────────

/** 从对象中排除指定字段返回新对象 */
export const omit = _omit;

/** 从对象中筛选指定字段返回新对象 */
export const pick = _pick;

/** 深拷贝 */
export const cloneDeep = _cloneDeep;

/** 深比较两个值是否相等 */
export const isEqual = _isEqual;

// ── 数组操作 ─────────────────────────────────────────────────

/** 按字段去重 */
export const uniqBy = _uniqBy;

/** 按字段分组 */
export const groupBy = _groupBy;

/** 按字段排序 */
export const sortBy = _sortBy;

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
