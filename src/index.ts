import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction
} from "discord.js";
import { CARD_CATALOG, findCards, isCardType, type CardType } from "./cards.js";
import {
  closeAllOpenTrades,
  closeAllExcessOpenTrades,
  closeExcessOpenTrades,
  closeTrade,
  countOpenTrades,
  countRecentTrades,
  createTrade,
  deleteTradeMatchNotification,
  findCompatibleOpenTrades,
  getClanTag,
  getClosedTrades,
  getTrade,
  getTradeCooldown,
  getTradeMatchNotification,
  hasRecentIdenticalTrade,
  saveClanTag,
  saveTradeMatchNotification,
  setTradeCooldown,
  type Trade
} from "./database.js";
import { renderTrade } from "./renderer.js";
import {
  buildDraftComponents,
  buildDraftEmbed,
  buildTradeButtons,
  buildTradeEmbed,
  MAX_CARDS_PER_SIDE,
  type TradeDraft
} from "./trade-view.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set in .env.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const drafts = new Map<string, TradeDraft>();
const publishingUsers = new Set<string>();
const MAX_OPEN_TRADES = 3;
const MAX_POSTS_PER_WINDOW = 3;
const POST_WINDOW_MS = 30 * 60 * 1_000;
const CLOSED_TRADE_COOLDOWN_MS = 5 * 60 * 1_000;
const CLOSED_TRADE_DELETE_DELAY_MS = 60 * 1_000;
const MAX_MATCH_LINKS = 3;
const UNKNOWN_MESSAGE_ERROR_CODE = 10_008;

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  const excessTrades = closeAllExcessOpenTrades(MAX_OPEN_TRADES);
  for (const trade of excessTrades) {
    setTradeCooldown(trade.ownerId, CLOSED_TRADE_COOLDOWN_MS);
    await closeTradePost(trade);
  }
  for (const trade of getClosedTrades()) {
    try {
      await deleteClosedTradePost(trade);
    } catch (error) {
      console.error(`Could not delete closed trade ${trade.id}:`, error);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    console.error("Interaction failed:", error);
    if (interaction.isRepliable()) {
      const response: InteractionReplyOptions = {
        content: "Something went wrong while handling that trade. Please try again.",
        flags: MessageFlags.Ephemeral
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "clan-link") {
    await handleClanLinkCommand(interaction);
    return;
  }
  if (interaction.commandName !== "trade") {
    return;
  }

  const type = interaction.options.getSubcommand();
  if (type === "close-all") {
    await handleCloseAllTradesCommand(interaction);
    return;
  }
  if (!isCardType(type)) {
    await interaction.reply({ content: "Unknown card type.", flags: MessageFlags.Ephemeral });
    return;
  }

  const draft: TradeDraft = {
    id: randomUUID(),
    ownerId: interaction.user.id,
    cardType: type,
    sending: [],
    requesting: [],
    requestAllOther: false
  };
  drafts.set(draft.id, draft);

  await interaction.reply({
    embeds: [buildDraftEmbed(draft)],
    components: buildDraftComponents(draft),
    flags: MessageFlags.Ephemeral
  });
}

async function handleCloseAllTradesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const trades = closeAllOpenTrades(interaction.user.id);
  if (!trades.length) {
    await interaction.editReply("You do not have any open trades.");
    return;
  }

  setTradeCooldown(interaction.user.id, CLOSED_TRADE_COOLDOWN_MS);
  for (const trade of trades) {
    try {
      await closeTradePost(trade);
    } catch (error) {
      console.error(`Could not close trade ${trade.id}:`, error);
    }
  }

  await interaction.editReply(`Closed your ${trades.length} open trade${trades.length === 1 ? "" : "s"}.`);
}

async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, draftId, side] = interaction.customId.split(":");
  if (!draftId || (side !== "sending" && side !== "requesting")) {
    return;
  }

  const draft = getOwnedDraft(interaction.user.id, draftId);
  if (!draft) {
    await interaction.reply({ content: "This trade builder has expired.", flags: MessageFlags.Ephemeral });
    return;
  }

  draft[side] = interaction.values;
  if (side === "requesting") {
    draft.requestAllOther = false;
  }
  await interaction.update({ embeds: [buildDraftEmbed(draft)], components: buildDraftComponents(draft) });
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action, id, operation] = interaction.customId.split(":");
  if (action === "draft" && operation) {
    await handleDraftButton(interaction, id, operation);
    return;
  }
  if (action === "close" && id) {
    await handleCloseButton(interaction, id);
  }
}

async function handleClanLinkCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const tag = normalizeClanTag(interaction.options.getString("tag", true));
  if (!tag) {
    await interaction.reply({
      content: "Enter a valid Clash clan tag, such as `#2PP`.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  saveClanTag(interaction.user.id, tag);
  await interaction.reply({
    content: `Saved your clan: [${tag}](<${buildClanLink(tag)}>). Future trade offers will include a **Join Clan** button.`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleDraftButton(interaction: ButtonInteraction, draftId: string, operation: string): Promise<void> {
  const draft = getOwnedDraft(interaction.user.id, draftId);
  if (!draft) {
    await interaction.reply({ content: "This trade builder has expired.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (operation === "cancel") {
    drafts.delete(draftId);
    await interaction.update({ content: "Trade creation cancelled.", embeds: [], components: [] });
    return;
  }

  if (operation === "all-other") {
    draft.requestAllOther = !draft.requestAllOther;
    draft.requesting = [];
    await interaction.update({ embeds: [buildDraftEmbed(draft)], components: buildDraftComponents(draft) });
    return;
  }

  if (operation !== "submit") {
    return;
  }

  const requestedCardIds = getRequestedCardIds(draft);
  if (!draft.sending.length || !requestedCardIds.length) {
    await interaction.reply({ content: "Select at least one card on each side first.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (draft.sending.some((cardId) => requestedCardIds.includes(cardId))) {
    await interaction.reply({ content: "The same card cannot be both offered and requested.", flags: MessageFlags.Ephemeral });
    return;
  }

  const sending = findCards(draft.cardType, draft.sending);
  const requesting = findCards(draft.cardType, requestedCardIds);
  if (sending.length !== draft.sending.length || requesting.length !== requestedCardIds.length) {
    await interaction.reply({ content: "One or more selected cards are no longer valid.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "I can only post trades in a server text channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (publishingUsers.has(interaction.user.id)) {
    await interaction.reply({
      content: "Your other trade is still being published.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  publishingUsers.add(interaction.user.id);
  try {
    const excessTrades = closeExcessOpenTrades(interaction.user.id, MAX_OPEN_TRADES);
    for (const trade of excessTrades) {
      setTradeCooldown(trade.ownerId, CLOSED_TRADE_COOLDOWN_MS);
      await closeTradePost(trade);
    }

    const cooldownUntil = getTradeCooldown(interaction.user.id);
    if (cooldownUntil) {
      const remainingSeconds = Math.ceil((cooldownUntil - Date.now()) / 1_000);
      await interaction.reply({
        content: `After closing a trade, you can publish another one in ${formatDuration(remainingSeconds)}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (countOpenTrades(interaction.user.id) >= MAX_OPEN_TRADES) {
      await interaction.reply({
        content: `You already have ${MAX_OPEN_TRADES} open trades. Close one before posting another.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (countRecentTrades(interaction.user.id, POST_WINDOW_MS) >= MAX_POSTS_PER_WINDOW) {
      await interaction.reply({
        content: `You can post at most ${MAX_POSTS_PER_WINDOW} trades every 30 minutes.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (hasRecentIdenticalTrade(interaction.user.id, draft.cardType, draft.sending, requestedCardIds, POST_WINDOW_MS)) {
      await interaction.reply({
        content: "You already posted this exact trade in the last 30 minutes.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const useAllCardsTile = draft.requestAllOther && requesting.length >= MAX_CARDS_PER_SIDE;
    const attachment = await renderTrade(draft.cardType, sending, requesting, useAllCardsTile);
    const clanTag = getClanTag(interaction.user.id);
    const message = await interaction.channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [buildTradeEmbed(interaction.user.id, draft.cardType, sending, requesting, useAllCardsTile)],
      files: [attachment],
      components: [buildTradeButtons(draft.id, clanTag ? buildClanLink(clanTag) : undefined)]
    });
    createTrade({
      id: draft.id,
      messageId: message.id,
      channelId: message.channelId,
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      cardType: draft.cardType,
      sending: draft.sending,
      requesting: requestedCardIds,
      status: "open",
      closedAt: null
    });
    drafts.delete(draft.id);
    if (interaction.guildId) {
      const matchingTrades = findCompatibleOpenTrades(
        interaction.guildId,
        interaction.user.id,
        requestedCardIds,
        draft.sending
      );
      if (matchingTrades.length) {
        const matchMessage = await interaction.channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [buildTradeMatchEmbed(draft.cardType, interaction.guildId, matchingTrades)],
          allowedMentions: { users: [interaction.user.id] }
        });
        saveTradeMatchNotification(draft.id, matchMessage.id, matchMessage.channelId);
      }
    }
    await interaction.update({ content: "Your trade offer has been posted.", embeds: [], components: [] });
  } finally {
    publishingUsers.delete(interaction.user.id);
  }
}

async function handleCloseButton(interaction: ButtonInteraction, tradeId: string): Promise<void> {
  const trade = getTrade(tradeId);
  if (!trade || trade.status !== "open") {
    await interaction.reply({ content: "This trade is already closed or no longer exists.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (trade.ownerId !== interaction.user.id) {
    await interaction.reply({ content: "Only the player who posted this trade can close it.", flags: MessageFlags.Ephemeral });
    return;
  }

  const sending = findCards(trade.cardType, trade.sending);
  const requesting = findCards(trade.cardType, trade.requesting);
  if (!closeTrade(tradeId)) {
    await interaction.reply({ content: "This trade was just closed.", flags: MessageFlags.Ephemeral });
    return;
  }
  setTradeCooldown(trade.ownerId, CLOSED_TRADE_COOLDOWN_MS);
  await deleteTradeMatchAlert(tradeId);

  await interaction.update({
    content: "",
    embeds: [buildTradeEmbed(trade.ownerId, trade.cardType, sending, requesting, false, true)],
    components: []
  });
  scheduleClosedTradeDeletion(interaction.message, trade.id);
}

async function closeTradePost(trade: Trade): Promise<void> {
  await deleteTradeMatchAlert(trade.id);
  const channel = await client.channels.fetch(trade.channelId);
  if (!channel?.isTextBased()) {
    return;
  }

  const message = await channel.messages.fetch(trade.messageId);
  const sending = findCards(trade.cardType, trade.sending);
  const requesting = findCards(trade.cardType, trade.requesting);
  await message.edit({
    content: "",
    embeds: [buildTradeEmbed(trade.ownerId, trade.cardType, sending, requesting, false, true)],
    components: []
  });
  scheduleClosedTradeDeletion(message, trade.id);
}

async function deleteClosedTradePost(trade: Trade): Promise<void> {
  await deleteTradeMatchAlert(trade.id);
  try {
    const channel = await client.channels.fetch(trade.channelId);
    if (!channel?.isTextBased()) {
      return;
    }
    await channel.messages.delete(trade.messageId);
  } catch (error) {
    if (hasDiscordErrorCode(error, UNKNOWN_MESSAGE_ERROR_CODE)) {
      return;
    }
    throw error;
  }
}

async function deleteTradeMatchAlert(tradeId: string): Promise<void> {
  const matchNotification = getTradeMatchNotification(tradeId);
  if (!matchNotification) {
    return;
  }

  const channel = await client.channels.fetch(matchNotification.channelId);
  if (channel?.isTextBased()) {
    try {
      await channel.messages.delete(matchNotification.messageId);
    } catch (error) {
      if (!hasDiscordErrorCode(error, UNKNOWN_MESSAGE_ERROR_CODE)) {
        throw error;
      }
    }
  }
  deleteTradeMatchNotification(tradeId);
}

function scheduleClosedTradeDeletion(message: ButtonInteraction["message"], tradeId: string): void {
  setTimeout(() => {
    void message.delete().catch((error: unknown) => {
      console.error(`Could not delete closed trade ${tradeId}:`, error);
    });
  }, CLOSED_TRADE_DELETE_DELAY_MS);
}

function getOwnedDraft(ownerId: string, draftId: string): TradeDraft | undefined {
  const draft = drafts.get(draftId);
  return draft?.ownerId === ownerId ? draft : undefined;
}

function getRequestedCardIds(draft: TradeDraft): string[] {
  if (!draft.requestAllOther) {
    return draft.requesting;
  }
  return CARD_CATALOG[draft.cardType].cards
    .map((card) => card.id)
    .filter((cardId) => !draft.sending.includes(cardId));
}

function buildTradeMatchEmbed(cardType: CardType, guildId: string, matchingTrades: ReturnType<typeof findCompatibleOpenTrades>): EmbedBuilder {
  const category = CARD_CATALOG[cardType];
  const displayedTrades = matchingTrades.slice(0, MAX_MATCH_LINKS);
  const links = displayedTrades.map((trade, index) => {
    const link = `https://discord.com/channels/${guildId}/${trade.channelId}/${trade.messageId}`;
    return `**${index + 1}.** [View matching trade](<${link}>)`;
  });
  const overflowNotice = matchingTrades.length > displayedTrades.length
    ? `\n\n*Showing the first ${displayedTrades.length} matches.*`
    : "";

  return new EmbedBuilder()
    .setColor(Number.parseInt(category.accent.slice(1), 16))
    .setTitle(`${matchingTrades.length} Potential Trade Match${matchingTrades.length === 1 ? "" : "es"}`)
    .setDescription(`${links.join("\n")}${overflowNotice}`);
}

function normalizeClanTag(value: string): string | undefined {
  const tag = value.trim().toUpperCase();
  if (!/^#?[0289OPYLQGRJCUV]{3,}$/.test(tag)) {
    return undefined;
  }
  return tag.startsWith("#") ? tag : `#${tag}`;
}

function buildClanLink(tag: string): string {
  return `https://link.clashofclans.com/en/?action=OpenClanProfile&tag=${tag.slice(1)}`;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function hasDiscordErrorCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

client.login(token);
