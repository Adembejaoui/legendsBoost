import { formatRankLabel } from "@/lib/catalog/rank-systems";
import { getGameServiceOffer } from "@/lib/catalog/catalog-utils";

interface RankDisplayProps {
  gameSlug: string;
  serviceSlug: string;
  selection: { tierId: string; divisionId: string | null } | null;
  label?: string;
}

export function RankDisplay({ gameSlug, serviceSlug, selection, label }: RankDisplayProps) {
  if (!selection) return null;

  const offer = getGameServiceOffer(gameSlug, serviceSlug);
  const rankSystemId = offer?.rankSystemId;

  if (!rankSystemId) return null;

  const formatted = formatRankLabel(rankSystemId, selection);

  return (
    <span className="flex items-center gap-1 text-sm">
      {label && (
        <span className="text-white/60 text-xs">{label}:</span>
      )}
      <span className="text-violet-300">{formatted}</span>
    </span>
  );
}
