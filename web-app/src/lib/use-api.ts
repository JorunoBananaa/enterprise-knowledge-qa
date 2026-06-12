/**
 * 封装了 apiFetch + ahooks useRequest 的快捷 Hook，免去每次手动导入 apiFetch
 *
 * @example // 自动 GET
 * const { data, loading } = useApi<Doc[]>("/documents");
 *
 * @example // 带 refreshDeps 的 GET
 * const { data } = useApi<Doc[]>("/documents", { refreshDeps: [filter] });
 *
 * @example // 手动 POST mutation — body 由 run(body) 传入
 * const { run, loading } = useApi<User>("/users", { method: "POST", manual: true });
 * run({ username: "foo" }); // → POST /users  JSON.stringify(body)
 *
 * @example // 动态路径
 * const { run } = useApi((id: number) => `/users/${id}`, { method: "DELETE", manual: true });
 * run(123); // → DELETE /users/123
 *
 * @example // 动态路径 + 带 body
 * const { run } = useApi((id: number) => `/users/${id}`, { method: "PATCH", manual: true });
 * run(123, { status: "disabled" }); // → PATCH /users/123  body: JSON.stringify({status:"disabled"})
 */
import { useRequest } from "ahooks";
import type { Options } from "ahooks/lib/useRequest/src/types";
import { apiFetch } from "./api";

type ApiPathFn<TParams extends any[] = any[]> = (...args: TParams) => string;

/** 非 GET 方法时允许末尾多传一个 body 参数 */
type FullParams<M extends string, TPathParams extends any[]> = M extends "GET"
  ? TPathParams
  : [...TPathParams, unknown?];

export function useApi<
  TData = any,
  TPathParams extends any[] = any[],
  M extends string = "GET",
>(
  pathOrBuilder: string | ApiPathFn<TPathParams>,
  options: {
    method?: M;
  } & Options<TData, FullParams<M, TPathParams>> = {} as any,
) {
  const { method = "GET", ...rest } = options;

  return useRequest(
    async (...args: FullParams<M, TPathParams>) => {
      // 计算最终路径
      // 非 GET 时，仅当最后一个参数是普通对象（非数组）时才视为 body
      const lastArg = args[args.length - 1];
      const hasBody =
        method !== "GET" &&
        lastArg !== undefined &&
        typeof lastArg === "object" &&
        !Array.isArray(lastArg);

      const pathParams =
        typeof pathOrBuilder === "function" && hasBody
          ? args.slice(0, -1)
          : args;
      const path =
        typeof pathOrBuilder === "function"
          ? pathOrBuilder(...(pathParams as TPathParams))
          : pathOrBuilder;

      // 非 GET 时，最后一个普通对象参数视为 request body
      const fetchOptions: RequestInit = {};
      if (method !== "GET") {
        fetchOptions.method = method;
        if (hasBody) {
          fetchOptions.body =
            lastArg instanceof FormData ? lastArg : JSON.stringify(lastArg);
        }
      }

      return apiFetch<TData>(path, fetchOptions);
    },
    rest as unknown as Options<TData, FullParams<M, TPathParams>>,
  );
}
