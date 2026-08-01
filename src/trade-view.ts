import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type APIEmbedField
} from "discord.js";
import { CARD_CATALOG, type Card, type CardType } from "./cards.js";

const MAX_CARDS_PER_SIDE = 9;

export interface TradeDraft {
  id: string;
  ownerId: string;
  cardType: CardType;
  sending: string[];
  requesting: string[];
  requestAllOther: boolean;
}

export function buildDraftComponents(draft: TradeDraft): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const category = CARD_CATALOG[draft.cardType];
  const maxCards = Math.min(MAX_CARDS_PER_SIDE, category.cards.length);
  const options = category.cards.map((card) => ({
    label: card.name,
    value: card.id,
    default: draft.sending.includes(card.id)
  }));
  const requestedOptions = category.cards.map((card) => ({
    label: card.name,
    value: card.id,
    default: draft.requesting.includes(card.id)
  }));

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`draft:${draft.id}:sending`)
        .setPlaceholder("Select cards you are offering")
        .setMinValues(1)
        .setMaxValues(maxCards)
        .addOptions(options)
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`draft:${draft.id}:requesting`)
        .setPlaceholder(draft.requestAllOther ? "Requesting every card not offered" : "Select cards you want")
        .setMinValues(1)
        .setMaxValues(maxCards)
        .setDisabled(draft.requestAllOther)
        .addOptions(requestedOptions)
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`draft:${draft.id}:submit`).setLabel("Publish trade").setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`draft:${draft.id}:all-other`)
        .setLabel(draft.requestAllOther ? "Choose specific cards" : "Want all other cards")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`draft:${draft.id}:cancel`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function buildDraftEmbed(draft: TradeDraft): EmbedBuilder {
  const category = CARD_CATALOG[draft.cardType];
  return new EmbedBuilder()
    .setColor(toColor(category.accent))
    .setTitle(`Create ${category.label} Trade`)
    .setDescription("Choose up to nine cards per side, or request every card you are not offering.")
    .addFields(
      { name: "Offering", value: draft.sending.length ? formatCards(draft.cardType, draft.sending) : "Nothing selected", inline: true },
      {
        name: "Want Any of",
        value: draft.requestAllOther
          ? `Every ${category.label.slice(0, -1).toLowerCase()} not offered`
          : draft.requesting.length
            ? formatCards(draft.cardType, draft.requesting)
            : "Nothing selected",
        inline: true
      }
    );
}

export function buildTradeEmbed(
  ownerId: string,
  type: CardType,
  sending: readonly Card[],
  requesting: readonly Card[],
  requestAllOther = false,
  closed = false
): EmbedBuilder {
  const category = CARD_CATALOG[type];
  const embed = new EmbedBuilder()
    .setColor(toColor(closed ? "#6b7280" : category.accent))
    .setAuthor({ name: closed ? "Trade Closed" : "Trade Offer" })
    .setTitle(category.label)
    .setDescription(closed ? `This offer from <@${ownerId}> is no longer available.` : `Posted by <@${ownerId}>`)
    .setFooter({ text: "Use /trade to post offers • Use /clan-link to save your clan tag" })
    .setImage("attachment://trade.png");

  if (!closed) {
    const fields: APIEmbedField[] = [
      { name: "Offering", value: sending.map((card) => `• ${card.name}`).join("\n"), inline: true },
      {
        name: "Want Any of",
        value: requestAllOther && requesting.length >= MAX_CARDS_PER_SIDE
          ? `Every ${category.label.slice(0, -1).toLowerCase()} not offered`
          : requesting.map((card) => `• ${card.name}`).join("\n"),
        inline: true
      }
    ];
    embed.addFields(fields);
  }

  return embed;
}

export function buildTradeButtons(tradeId: string, clanLink?: string): ActionRowBuilder<ButtonBuilder> {
  const buttons = [
    new ButtonBuilder().setCustomId(`close:${tradeId}`).setLabel("Close Trade").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
  ];

  if (clanLink) {
    buttons.unshift(
      new ButtonBuilder()
        .setLabel("Join Clan")
        .setEmoji({ id: "1533016763367690260", name: "clan_castle" })
        .setStyle(ButtonStyle.Link)
        .setURL(clanLink)
    );
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

function formatCards(type: CardType, cardIds: readonly string[]): string {
  const cardsById = new Map(CARD_CATALOG[type].cards.map((card) => [card.id, card]));
  return cardIds.map((id) => `• ${cardsById.get(id)?.name ?? id}`).join("\n");
}

export { MAX_CARDS_PER_SIDE };

function toColor(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
