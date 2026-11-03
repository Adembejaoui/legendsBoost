import type {
  GameServiceOffer,
  GameDefinition,
  RankSelection,
  ServiceTemplate,
} from '@/types/catalog'
import { getGame, getGames } from './games'
import { getServiceTemplate, getServiceTemplates } from './service-templates'
import { getGameServiceOffer, getGameServiceOffers, isGameServiceOffer } from './game-services'
import {
  getRankSystem,
  getRankSystemsByGame,
  getTier,
  getDivision,
  rankScore,
  isTargetAboveCurrent,
  formatRankLabel,
} from './rank-systems'
import { getChampions, getChampion } from './champions'

export {
  getGame,
  getGames,
  getServiceTemplate,
  getServiceTemplates,
  getGameServiceOffer,
  getGameServiceOffers,
  isGameServiceOffer,
  getRankSystem,
  getRankSystemsByGame,
  getTier,
  getDivision,
  rankScore,
  isTargetAboveCurrent,
  formatRankLabel,
  getChampions,
  getChampion,
}

export interface OfferWithTemplate {
  offer: GameServiceOffer
  template: ServiceTemplate
  game: GameDefinition
}

export function getOfferWithTemplate(
  gameSlug: string,
  serviceSlug: string,
): OfferWithTemplate | undefined {
  const game = getGame(gameSlug)
  const offer = getGameServiceOffer(gameSlug, serviceSlug)
  const template = offer ? getServiceTemplate(offer.serviceSlug) : undefined
  if (!game || !offer || !template) return undefined
  return { offer, template, game }
}

export function getOffersWithTemplate(gameSlug: string): OfferWithTemplate[] {
  const game = getGame(gameSlug)
  if (!game) return []
  return getGameServiceOffers(gameSlug)
    .map((offer) => {
      const template = getServiceTemplate(offer.serviceSlug)
      return template ? { offer, template, game } : null
    })
    .filter((entry): entry is OfferWithTemplate => entry !== null)
}

export function availabilityLabel(offer: GameServiceOffer): string {
  return offer.availabilityLabel ?? offer.availability
}

export function isAvailable(offer: GameServiceOffer): boolean {
  return offer.availability === 'available'
}

export function isOrderable(offer: GameServiceOffer): boolean {
  return true
}

export function formatSelection(
  rankSystemId: string | undefined,
  selection: RankSelection | null,
): string {
  if (!rankSystemId || !selection) return 'Not selected'
  return formatRankLabel(rankSystemId, selection)
}
