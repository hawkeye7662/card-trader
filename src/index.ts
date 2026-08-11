import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  Client,
  ChannelType,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction
} from "discord.js";
import { CARD_CATALOG, findCards, isCardType, type CardType } from "./cards.js";
import {
  closeAllOpenTrades,
  closeAllExcessOpenTrades,
  closeExcessOpenTrades,
  closeOpenTradesByType,
  closeTrade,
  countRecentTrades,
  createTrade,
  deleteTradeMatchNotification,
  deleteTradeThread,
  deleteTradeThreadPost as deleteStoredTradeThreadPost,
  findCompatibleOpenTrades,
  getClanTag,
  getClosedTrades,
  getOpenTrades,
  getTrade,
  getTradeMatchNotification,
  getTradeThreadId,
  getTradeThreadPost,
  hasRecentIdenticalTrade,
  saveClanTag,
  saveTradeMatchNotification,
  saveTradeThread,
  saveTradeThreadPost,
  type Trade
} from "./database.js";
import { renderTrade } from "./renderer.js";
import {
  buildDraftComponents,
  buildDraftEmbed,
  buildTradeButtons,
  buildTradeEmbed,
  buildTradeThreadEmbed,
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
const CLOSED_TRADE_DELETE_DELAY_MS = 60 * 1_000;
const MAX_MATCH_LINKS = 3;
const MAX_FIND_MATCH_LINKS = 10;
const MAX_MATCH_EMBED_DESCRIPTION_LENGTH = 3_800;
const UNKNOWN_MESSAGE_ERROR_CODE = 10_008;
const UNKNOWN_CHANNEL_ERROR_CODE = 10_003;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
  void cleanUpClosedTrades().catch((error) => {
    console.error("Closed-trade cleanup failed:", error);
  });
});

async function cleanUpClosedTrades(): Promise<void> {
  const excessTrades = closeAllExcessOpenTrades(MAX_OPEN_TRADES);
  for (const trade of excessTrades) {
    await closeTradePost(trade);
  }
  for (const trade of getClosedTrades()) {
    try {
      await deleteClosedTradePost(trade);
    } catch (error) {
      console.error(`Could not delete closed trade ${trade.id}:`, error);
    }
  }
}

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction);
});

async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  } catch (error) {
    logInteractionError("Interaction failed", error);
    await sendInteractionFailure(interaction);
  }
}

async function sendInteractionFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) {
    return;
  }

  const response: InteractionReplyOptions = {
    content: "Something went wrong while handling that trade. Please try again.",
    flags: MessageFlags.Ephemeral
  };
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: response.content, embeds: [], components: [] });
    } else if (interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  } catch (error) {
    logInteractionError("Could not send interaction failure response", error);
  }
}

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
  if (type === "find-matches") {
    await handleFindMatchesCommand(interaction);
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

  for (const trade of trades) {
    try {
      await closeTradePost(trade);
    } catch (error) {
      console.error(`Could not close trade ${trade.id}:`, error);
    }
  }

  await interaction.editReply(`Closed your ${trades.length} open trade${trades.length === 1 ? "" : "s"}.`);
}

async function handleFindMatchesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "I can only find matches in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const matchEmojis = await getTradeMatchEmojis(interaction.guildId);
  const embeds: EmbedBuilder[] = [];
  for (const trade of getOpenTrades(interaction.user.id)) {
    const matches = findCompatibleOpenTrades(interaction.guildId, interaction.user.id, trade.requesting, trade.sending);
    if (!matches.length) {
      continue;
    }
    embeds.push(
      await buildTradeMatchEmbed(
        trade.cardType,
        interaction.guildId,
        matches,
        trade.requesting,
        trade.sending,
        getTradeThreadId(trade.channelId, trade.cardType),
        matchEmojis,
        MAX_FIND_MATCH_LINKS,
        false
      )
    );
  }

  if (!embeds.length) {
    await interaction.editReply("No matching open trades found.");
    return;
  }
  await interaction.editReply({ embeds });
}

async function getTradeChannel(
  channel: NonNullable<ChatInputCommandInteraction["channel"]>,
  cardType: CardType
) {
  if (channel.isThread()) {
    return channel;
  }

  const threadId = getTradeThreadId(channel.id, cardType);
  if (threadId) {
    try {
      const thread = await client.channels.fetch(threadId);
      if (thread?.isThread() && thread.isSendable()) {
        if (thread.archived) {
          await thread.setArchived(false);
        }
        if (thread.name !== getTradeThreadName(cardType)) {
          await thread.setName(getTradeThreadName(cardType));
        }
        return thread;
      }
    } catch (error) {
      if (!hasDiscordErrorCode(error, UNKNOWN_CHANNEL_ERROR_CODE)) {
        throw error;
      }
    }
    deleteTradeThread(channel.id, cardType);
  }

  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    throw new Error("Trade threads can only be created from a server text channel.");
  }

  const thread = await channel.threads.create({
    name: getTradeThreadName(cardType),
    autoArchiveDuration: 1_440
  });
  saveTradeThread(channel.id, cardType, thread.id);
  return thread;
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

  if (!interaction.guildId || !interaction.channel?.isSendable()) {
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

  const openTrades = getOpenTrades(interaction.user.id);
  const openTradesOfType = openTrades.filter((trade) => trade.cardType === draft.cardType);
  if (openTrades.length - openTradesOfType.length >= MAX_OPEN_TRADES) {
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

  await interaction.deferUpdate();
  await interaction.editReply({ content: "Publishing your trade...", embeds: [], components: [] });
  publishingUsers.add(interaction.user.id);
  try {
    const excessTrades = closeExcessOpenTrades(interaction.user.id, MAX_OPEN_TRADES);
    for (const trade of excessTrades) {
      await closeTradePost(trade);
    }

    const useAllCardsTile = draft.requestAllOther && requesting.length >= MAX_CARDS_PER_SIDE;
    const attachment = await renderTrade(draft.cardType, sending, requesting, useAllCardsTile);
    const replacedTrades = closeOpenTradesByType(interaction.user.id, draft.cardType);
    for (const trade of replacedTrades) {
      await closeTradePost(trade);
    }
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
    let threadPostFailed = false;
    let tradeThreadId: string | undefined;
    try {
      const tradeThread = await getTradeChannel(interaction.channel, draft.cardType);
      tradeThreadId = tradeThread.id;
      const threadMessage = await tradeThread.send({
        content: `<@${interaction.user.id}>`,
        embeds: [buildTradeThreadEmbed(draft.cardType)],
        files: [await renderTrade(draft.cardType, sending, requesting, useAllCardsTile)],
        allowedMentions: { parse: [] }
      });
      saveTradeThreadPost(draft.id, threadMessage.id, threadMessage.channelId);
    } catch (error) {
      threadPostFailed = true;
      console.error(`Could not create trade thread post ${draft.id}:`, error);
    }
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
          embeds: [
            await buildTradeMatchEmbed(
              draft.cardType,
              interaction.guildId,
              matchingTrades,
              requestedCardIds,
              draft.sending,
              tradeThreadId
            )
          ],
          allowedMentions: { users: [interaction.user.id] }
        });
        saveTradeMatchNotification(draft.id, matchMessage.id, matchMessage.channelId);
      }
    }
    await interaction.editReply({
      content: threadPostFailed
        ? "Your trade offer has been posted, but it could not be added to the browse thread."
        : "Your trade offer has been posted.",
      embeds: [],
      components: []
    });
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
  await deleteTradeMatchAlert(tradeId);

  await interaction.update({
    content: "",
    embeds: [buildTradeEmbed(trade.ownerId, trade.cardType, sending, requesting, false, true)],
    components: []
  });
  scheduleClosedTradeDeletion(interaction.message, trade.id);
  await deleteThreadTradePost(trade.id);
}

async function closeTradePost(trade: Trade): Promise<void> {
  await deleteTradeMatchAlert(trade.id);
  const channel = await client.channels.fetch(trade.channelId);
  if (!channel?.isTextBased()) {
    await deleteThreadTradePost(trade.id);
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
  await deleteThreadTradePost(trade.id);
}

async function deleteClosedTradePost(trade: Trade): Promise<void> {
  await deleteTradeMatchAlert(trade.id);
  try {
    const channel = await client.channels.fetch(trade.channelId);
    if (channel?.isTextBased()) {
      await channel.messages.delete(trade.messageId);
    }
  } catch (error) {
    if (
      !hasDiscordErrorCode(error, UNKNOWN_MESSAGE_ERROR_CODE) &&
      !hasDiscordErrorCode(error, UNKNOWN_CHANNEL_ERROR_CODE)
    ) {
      throw error;
    }
  }
  await deleteThreadTradePost(trade.id);
}

async function deleteThreadTradePost(tradeId: string): Promise<void> {
  const threadPost = getTradeThreadPost(tradeId);
  if (!threadPost) {
    return;
  }

  try {
    const channel = await client.channels.fetch(threadPost.channelId);
    if (channel?.isTextBased()) {
      await channel.messages.delete(threadPost.messageId);
    }
  } catch (error) {
    if (
      !hasDiscordErrorCode(error, UNKNOWN_MESSAGE_ERROR_CODE) &&
      !hasDiscordErrorCode(error, UNKNOWN_CHANNEL_ERROR_CODE)
    ) {
      throw error;
    }
  }
  deleteStoredTradeThreadPost(tradeId);
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

async function buildTradeMatchEmbed(
  cardType: CardType,
  guildId: string,
  matchingTrades: ReturnType<typeof findCompatibleOpenTrades>,
  requestedCardIds: readonly string[],
  offeredCardIds: readonly string[],
  tradeThreadId?: string,
  matchEmojis?: TradeMatchEmojis,
  maximumLinks = MAX_MATCH_LINKS,
  showFindMatchesHint = true
): Promise<EmbedBuilder> {
  const category = CARD_CATALOG[cardType];
  const displayedTrades = matchingTrades.slice(0, maximumLinks);
  const { arrow, emojiByName } = matchEmojis ?? await getTradeMatchEmojis(guildId);
  const matchLinks = displayedTrades.map((trade, index) => {
    const link = `https://discord.com/channels/${guildId}/${trade.channelId}/${trade.messageId}`;
    const cardsTheyHave = trade.sending.filter((cardId) => requestedCardIds.includes(cardId));
    const cardsTheyWant = trade.requesting.filter((cardId) => offeredCardIds.includes(cardId));
    return (
      `**${index + 1}.** [View matching trade](<${link}>) ` +
      `${formatTradeMatchCards(cardsTheyHave, emojiByName)} ${arrow} ` +
      `${formatTradeMatchCards(cardsTheyWant, emojiByName)}`
    );
  });
  const links: string[] = [];
  for (const matchLink of matchLinks) {
    const nextLength = links.join("\n").length + matchLink.length + 1;
    if (nextLength > MAX_MATCH_EMBED_DESCRIPTION_LENGTH) {
      break;
    }
    links.push(matchLink);
  }
  const overflowNotice = matchingTrades.length > links.length
    ? `\n\n*Showing the first ${links.length} matches.*${showFindMatchesHint ? " Use `/trade find-matches` to find more matches." : ""}`
    : "";
  const tradeType = category.label.replace(/ Cards$/, "").toLowerCase();
  const threadNotice = tradeThreadId ? `\n\nBrowse all open ${tradeType} trades: <#${tradeThreadId}>` : "";

  return new EmbedBuilder()
    .setColor(Number.parseInt(category.accent.slice(1), 16))
    .setTitle(`${category.label}: ${matchingTrades.length} Potential Match${matchingTrades.length === 1 ? "" : "es"}`)
    .setDescription(`${links.join("\n")}${overflowNotice}${threadNotice}`);
}

interface TradeMatchEmojis {
  arrow: string;
  emojiByName: Map<string, string>;
}

async function getTradeMatchEmojis(guildId: string): Promise<TradeMatchEmojis> {
  const emojiByName = new Map<string, string>();
  try {
    const guild = await client.guilds.fetch(guildId);
    const emojis = await guild.emojis.fetch();
    addEmojisByName(emojiByName, emojis.values());
  } catch (error) {
    console.error(`Could not fetch server trade match emojis for guild ${guildId}:`, error);
  }
  try {
    if (client.application) {
      addEmojisByName(emojiByName, (await client.application.emojis.fetch()).values());
    }
  } catch (error) {
    console.error("Could not fetch application trade match emojis:", error);
  }

  return { arrow: emojiByName.get("trade_arrow") ?? "→", emojiByName };
}

function addEmojisByName(
  emojiByName: Map<string, string>,
  emojis: Iterable<{ name: string | null; toString(): string }>
): void {
  for (const emoji of emojis) {
    if (emoji.name) {
      emojiByName.set(emoji.name, emoji.toString());
    }
  }
}

function formatTradeMatchCards(cardIds: readonly string[], emojiByName: ReadonlyMap<string, string>): string {
  return cardIds
    .map((cardId) => {
      const emoji = emojiByName.get(cardId.replaceAll("-", "_"));
      return emoji ?? "❔";
    })
    .join(" ");
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

function getTradeThreadName(cardType: CardType): string {
  return `${CARD_CATALOG[cardType].label} - Read Only`;
}

function hasDiscordErrorCode(error: unknown, code: number): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function logInteractionError(context: string, error: unknown): void {
  const details = {
    name: error instanceof Error ? error.name : undefined,
    message: error instanceof Error ? error.message : undefined,
    code: getErrorProperty(error, "code"),
    status: getErrorProperty(error, "status"),
    rawError: getErrorProperty(error, "rawError"),
    stack: error instanceof Error ? error.stack : undefined
  };
  console.error(`${context}: ${JSON.stringify(details, null, 2)}`);
}

function getErrorProperty(error: unknown, property: string): unknown {
  if (typeof error !== "object" || error === null || !(property in error)) {
    return undefined;
  }
  return (error as Record<string, unknown>)[property];
}

client.login(token);
