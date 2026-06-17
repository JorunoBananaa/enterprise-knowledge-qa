import { memo, useMemo } from "react";
import type { CitationItem, SourceSummary } from "../_types";
import { buildSourceSummaries } from "../_lib/message-utils";

interface SourceChipsProps {
  citations?: CitationItem[];
  onSelectSource: (source: SourceSummary) => void;
}

const SourceChips = memo(function SourceChips({
  citations,
  onSelectSource,
}: SourceChipsProps) {
  const sources = useMemo(() => buildSourceSummaries(citations), [citations]);

  if (sources.length === 0) {
    return <div className="flex min-w-0 flex-1" />;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <span className="shrink-0 text-xs text-zinc-400">来源</span>
      {sources.map((source) => (
        <button
          key={source.key}
          type="button"
          title={source.name}
          onClick={() => onSelectSource(source)}
          className="inline-flex h-6 max-w-[180px] min-w-0 items-center rounded-md border border-app-border-soft bg-zinc-50 px-2 text-xs text-zinc-600 transition-colors hover:border-app-primary hover:text-app-primary"
        >
          <span className="block min-w-0 truncate">{source.name}</span>
        </button>
      ))}
    </div>
  );
});

export default SourceChips;
