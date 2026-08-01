export const CARD_TYPES = [
  'elixir',
  'dark-elixir',
  'builder-base',
  'super-troop',
] as const

export type CardType = (typeof CARD_TYPES)[number]

export interface Card {
  id: string
  name: string
  imagePath?: string
}

export interface CardCategory {
  label: string
  accent: string
  cards: readonly Card[]
}

export const CARD_CATALOG: Record<CardType, CardCategory> = {
  elixir: {
    label: 'Elixir Cards',
    accent: '#be57eb',
    cards: [
      { id: 'elixir-barbarian', name: 'Barbarian', imagePath: 'assets/cards/elixir/00-barbarian.webp' },
      { id: 'elixir-archer', name: 'Archer', imagePath: 'assets/cards/elixir/01-archer.webp' },
      { id: 'elixir-giant', name: 'Giant', imagePath: 'assets/cards/elixir/02-giant.webp' },
      { id: 'elixir-goblin', name: 'Goblin', imagePath: 'assets/cards/elixir/03-goblin.webp' },
      { id: 'elixir-wall-breaker', name: 'Wall Breaker', imagePath: 'assets/cards/elixir/04-wallBreaker.webp' },
      { id: 'elixir-balloon', name: 'Balloon', imagePath: 'assets/cards/elixir/05-balloon.webp' },
      { id: 'elixir-wizard', name: 'Wizard', imagePath: 'assets/cards/elixir/06-wizard.webp' },
      { id: 'elixir-healer', name: 'Healer', imagePath: 'assets/cards/elixir/07-healer.webp' },
      { id: 'elixir-dragon', name: 'Dragon', imagePath: 'assets/cards/elixir/08-dragon.webp' },
      { id: 'elixir-pekka', name: 'P.E.K.K.A', imagePath: 'assets/cards/elixir/09-pekka.webp' },
      { id: 'elixir-baby-dragon', name: 'Baby Dragon', imagePath: 'assets/cards/elixir/10-babyDragon.webp' },
      { id: 'elixir-miner', name: 'Miner', imagePath: 'assets/cards/elixir/11-miner.webp' },
      { id: 'elixir-electro-dragon', name: 'Electro Dragon', imagePath: 'assets/cards/elixir/12-electroDragon.webp' },
      { id: 'elixir-yeti', name: 'Yeti', imagePath: 'assets/cards/elixir/13-yeti.webp' },
      { id: 'elixir-dragon-rider', name: 'Dragon Rider', imagePath: 'assets/cards/elixir/14-dragonRider.webp' },
      { id: 'elixir-electro-titan', name: 'Electro Titan', imagePath: 'assets/cards/elixir/15-electroTitan.webp' },
      { id: 'elixir-root-rider', name: 'Root Rider', imagePath: 'assets/cards/elixir/16-rootRider.webp' },
      { id: 'elixir-meteor-golem', name: 'Meteor Golem', imagePath: 'assets/cards/elixir/17-meteorGolem.webp' },
      { id: 'elixir-thrower', name: 'Thrower', imagePath: 'assets/cards/elixir/18-thrower.webp' },
    ],
  },
  'dark-elixir': {
    label: 'Dark Elixir Cards',
    accent: '#734a9e',
    cards: [
      { id: 'dark-elixir-minion', name: 'Minion', imagePath: 'assets/cards/darkElixir/00-minion.webp' },
      { id: 'dark-elixir-hog-rider', name: 'Hog Rider', imagePath: 'assets/cards/darkElixir/01-hogRider.webp' },
      { id: 'dark-elixir-valkyrie', name: 'Valkyrie', imagePath: 'assets/cards/darkElixir/02-valkyrie.webp' },
      { id: 'dark-elixir-golem', name: 'Golem', imagePath: 'assets/cards/darkElixir/03-golem.webp' },
      { id: 'dark-elixir-witch', name: 'Witch', imagePath: 'assets/cards/darkElixir/04-witch.webp' },
      { id: 'dark-elixir-lava-hound', name: 'Lava Hound', imagePath: 'assets/cards/darkElixir/05-lavaHound.webp' },
      { id: 'dark-elixir-bowler', name: 'Bowler', imagePath: 'assets/cards/darkElixir/06-bowler.webp' },
      { id: 'dark-elixir-ice-golem', name: 'Ice Golem', imagePath: 'assets/cards/darkElixir/07-iceGolem.webp' },
      { id: 'dark-elixir-headhunter', name: 'Headhunter', imagePath: 'assets/cards/darkElixir/08-headHunter.webp' },
      { id: 'dark-elixir-apprentice-warden', name: 'Apprentice Warden', imagePath: 'assets/cards/darkElixir/09-apprenticeWarden.webp' },
      { id: 'dark-elixir-druid', name: 'Druid', imagePath: 'assets/cards/darkElixir/10-druid.webp' },
      { id: 'dark-elixir-furnace', name: 'Furnace', imagePath: 'assets/cards/darkElixir/11-furnace.webp' },
      { id: 'dark-elixir-ruin-witch', name: 'Ruin Witch', imagePath: 'assets/cards/darkElixir/12-ruinWitch.webp' },
    ],
  },
  'builder-base': {
    label: 'Builder Base Cards',
    accent: '#e49638',
    cards: [
      { id: 'builder-base-raged-barbarian', name: 'Raged Barbarian', imagePath: 'assets/cards/builderBase/00-ragedBarbarian.webp' },
      { id: 'builder-base-sneaky-archer', name: 'Sneaky Archer', imagePath: 'assets/cards/builderBase/01-sneakyArcher.webp' },
      { id: 'builder-base-boxer-giant', name: 'Boxer Giant', imagePath: 'assets/cards/builderBase/02-boxerGiant.webp' },
      { id: 'builder-base-beta-minion', name: 'Beta Minion', imagePath: 'assets/cards/builderBase/03-betaMinion.webp' },
      { id: 'builder-base-bomber', name: 'Bomber', imagePath: 'assets/cards/builderBase/04-bomber.webp' },
      { id: 'builder-base-baby-dragon', name: 'Baby Dragon', imagePath: 'assets/cards/builderBase/05-babyDragon.webp' },
      { id: 'builder-base-cannon-cart', name: 'Cannon Cart', imagePath: 'assets/cards/builderBase/06-cannonCart.webp' },
      { id: 'builder-base-night-witch', name: 'Night Witch', imagePath: 'assets/cards/builderBase/07-nightWitch.webp' },
      { id: 'builder-base-drop-ship', name: 'Drop Ship', imagePath: 'assets/cards/builderBase/08-dropShip.webp' },
      { id: 'builder-base-power-pekka', name: 'Power P.E.K.K.A', imagePath: 'assets/cards/builderBase/09-powerPekka.webp' },
      { id: 'builder-base-hog-glider', name: 'Hog Glider', imagePath: 'assets/cards/builderBase/10-hogGlider.webp' },
    ],
  },
  'super-troop': {
    label: 'Super Troop Cards',
    accent: '#e83b57',
    cards: [
      { id: 'super-troop-super-barbarian', name: 'Super Barbarian', imagePath: 'assets/cards/superTroops/00-superBarbarian.webp' },
      { id: 'super-troop-sneaky-archer', name: 'Sneaky Archer', imagePath: 'assets/cards/superTroops/01-sneakyArcher.webp' },
      { id: 'super-troop-sneaky-goblin', name: 'Sneaky Goblin', imagePath: 'assets/cards/superTroops/02-sneakyGoblin.webp' },
      { id: 'super-troop-super-wall-breaker', name: 'Super Wall Breaker', imagePath: 'assets/cards/superTroops/03-superWallBreaker.webp' },
      { id: 'super-troop-super-giant', name: 'Super Giant', imagePath: 'assets/cards/superTroops/04-superGiant.webp' },
      { id: 'super-troop-rocket-balloon', name: 'Rocket Balloon', imagePath: 'assets/cards/superTroops/05-rocketBalloon.webp' },
      { id: 'super-troop-super-wizard', name: 'Super Wizard', imagePath: 'assets/cards/superTroops/06-superWizard.webp' },
      { id: 'super-troop-super-dragon', name: 'Super Dragon', imagePath: 'assets/cards/superTroops/07-superDragon.webp' },
      { id: 'super-troop-inferno-dragon', name: 'Inferno Dragon', imagePath: 'assets/cards/superTroops/08-infernoDragon.webp' },
      { id: 'super-troop-super-minion', name: 'Super Minion', imagePath: 'assets/cards/superTroops/09-superMinion.webp' },
      { id: 'super-troop-super-valkyrie', name: 'Super Valkyrie', imagePath: 'assets/cards/superTroops/10-superValkyrie.webp' },
      { id: 'super-troop-super-witch', name: 'Super Witch', imagePath: 'assets/cards/superTroops/11-superWitch.webp' },
      { id: 'super-troop-ice-hound', name: 'Ice Hound', imagePath: 'assets/cards/superTroops/12-iceHound.webp' },
      { id: 'super-troop-super-bowler', name: 'Super Bowler', imagePath: 'assets/cards/superTroops/13-superBowler.webp' },
      { id: 'super-troop-super-miner', name: 'Super Miner', imagePath: 'assets/cards/superTroops/14-superMiner.webp' },
      { id: 'super-troop-super-yeti', name: 'Super Yeti', imagePath: 'assets/cards/superTroops/15-superYeti.webp' },
      { id: 'super-troop-super-hog-rider', name: 'Super Hog Rider', imagePath: 'assets/cards/superTroops/16-superHogRider.webp' },
    ],
  },
}

export function isCardType(value: string): value is CardType {
  return (CARD_TYPES as readonly string[]).includes(value)
}

export function findCards(type: CardType, ids: readonly string[]): Card[] {
  const cardById = new Map(
    CARD_CATALOG[type].cards.map((card) => [card.id, card]),
  )
  return ids
    .map((id) => cardById.get(id))
    .filter((card): card is Card => card !== undefined)
}
