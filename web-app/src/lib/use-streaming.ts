"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetchStream, type StreamEvent } from "./api";

/**
 * React Hook that wraps {@link apiFetchStream} with:
 * - built-in {@link AbortController} (auto-abort on unmount + manual abort)
 * - loading state
 *
 * @example
 * ```ts
 * const { run, abort, loading } = useApiStream();
 *
 * for await (const event of run("/qa/ask/stream", { method: "POST", body: ... })) {
 *   // handle event
 * }
 * ```
 */
export function useApiStream() {
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const run = useCallback(async function* (
    path: string,
    options: RequestInit = {},
  ): AsyncGenerator<StreamEvent, void, undefined> {
    // Abort any in-flight request
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      yield* apiFetchStream(path, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      setLoading(false);
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { run, abort, loading } as const;
}
