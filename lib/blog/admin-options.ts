import { getGames } from "@/lib/catalog/games";
import { gameServices } from "@/lib/catalog/game-services";
import { getServiceTemplate } from "@/lib/catalog/service-templates";

/** Games and "game/service" choices for the blog editor. */
export function blogEditorOptions() {
  const games = getGames().map((g) => ({ slug: g.slug, name: g.name }));
  const services = gameServices
    .filter((s) => s.visibility !== "hidden")
    .map((s) => ({
      value: `${s.gameSlug}/${s.serviceSlug}`,
      label: `${games.find((g) => g.slug === s.gameSlug)?.name ?? s.gameSlug} · ${s.title ?? getServiceTemplate(s.serviceSlug)?.title ?? s.serviceSlug}`,
    }));
  return { games, services };
}
