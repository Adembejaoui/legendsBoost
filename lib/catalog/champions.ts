import type { Champion } from '@/types/catalog'

// Configurable champion data source. Champion options for the champion-picker
// field come from here and are independent of the service and game configuration.
export const champions: Champion[] = [
  { id: 'ahri', name: 'Ahri', iconSrc: '/images/champions/ahri.png' },
  { id: 'akali', name: 'Akali', iconSrc: '/images/champions/akali.png' },
  { id: 'ashe', name: 'Ashe', iconSrc: '/images/champions/ashe.png' },
  { id: 'darius', name: 'Darius', iconSrc: '/images/champions/darius.png' },
  { id: 'ezreal', name: 'Ezreal', iconSrc: '/images/champions/ezreal.png' },
  { id: 'jinx', name: 'Jinx', iconSrc: '/images/champions/jinx.png' },
  { id: 'kaihasa', name: "Kai'Sa", iconSrc: '/images/champions/kaihasa.png' },
  { id: 'lee-sin', name: "Lee Sin", iconSrc: '/images/champions/lee-sin.png' },
  { id: 'lux', name: 'Lux', iconSrc: '/images/champions/lux.png' },
  { id: 'master-yi', name: 'Master Yi', iconSrc: '/images/champions/master-yi.png' },
  { id: 'ryze', name: 'Ryze', iconSrc: '/images/champions/ryze.png' },
  { id: 'thresh', name: 'Thresh', iconSrc: '/images/champions/thresh.png' },
  { id: 'yasuo', name: 'Yasuo', iconSrc: '/images/champions/yasuo.png' },
  { id: 'yone', name: 'Yone', iconSrc: '/images/champions/yone.png' },
  { id: 'zed', name: 'Zed', iconSrc: '/images/champions/zed.png' },
]

export function getChampions(): Champion[] {
  return champions
}

export function getChampion(id: string): Champion | undefined {
  return champions.find((champion) => champion.id === id)
}
