import "dotenv/config";
import { randomUUID } from "node:crypto";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction
} from "discord.js";
import { findCards, isCardType, type CardType } from "./cards.js";
import {
  claimTradeSlot,
  clearTradeCooldown,
  closeTrade,
  createTrade,
  getClanTag,
  getTrade,
  releaseTradeSlot,
  saveClanTag
} from "./database.js";
import { renderTrade } from "./renderer.js";
import { buildDraftComponents, buildDraftEmbed, buildTradeButtons, buildTradeEmbed, type TradeDraft } from "./trade-view.js";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error("DISCORD_TOKEN must be set in .env.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const drafts = new Map<string, TradeDraft>();
const TRADE_COOLDOWN_MS = 2 * 60 * 1_000;

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}.`);
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
  if (!isCardType(type)) {
    await interaction.reply({ content: "Unknown card type.", flags: MessageFlags.Ephemeral });
    return;
  }

  const draft: TradeDraft = {
    id: randomUUID(),
    ownerId: interaction.user.id,
    cardType: type,
    sending: [],
    requesting: []
  };
  drafts.set(draft.id, draft);

  await interaction.reply({
    embeds: [buildDraftEmbed(draft)],
    components: buildDraftComponents(draft),
    flags: MessageFlags.Ephemeral
  });
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

  if (operation !== "submit") {
    return;
  }

  if (!draft.sending.length || !draft.requesting.length) {
    await interaction.reply({ content: "Select at least one card on each side first.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (draft.sending.some((cardId) => draft.requesting.includes(cardId))) {
    await interaction.reply({ content: "The same card cannot be both offered and requested.", flags: MessageFlags.Ephemeral });
    return;
  }

  const sending = findCards(draft.cardType, draft.sending);
  const requesting = findCards(draft.cardType, draft.requesting);
  if (sending.length !== draft.sending.length || requesting.length !== draft.requesting.length) {
    await interaction.reply({ content: "One or more selected cards are no longer valid.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.channel?.isSendable()) {
    await interaction.reply({ content: "I can only post trades in a server text channel.", flags: MessageFlags.Ephemeral });
    return;
  }

  const slot = claimTradeSlot(interaction.user.id, TRADE_COOLDOWN_MS);
  if (!slot.granted) {
    const remainingSeconds = Math.ceil((slot.cooldownUntil - Date.now()) / 1_000);
    await interaction.reply({
      content: `You can publish another trade in ${formatDuration(remainingSeconds)}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let published = false;
  try {
    const attachment = await renderTrade(draft.cardType, sending, requesting);
    const clanTag = getClanTag(interaction.user.id);
    const message = await interaction.channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [buildTradeEmbed(interaction.user.id, draft.cardType, sending, requesting)],
      files: [attachment],
      components: [buildTradeButtons(draft.id, clanTag ? buildClanLink(clanTag) : undefined)]
    });
    createTrade({
      id: draft.id,
      messageId: message.id,
      channelId: message.channelId,
      ownerId: interaction.user.id,
      cardType: draft.cardType,
      sending: draft.sending,
      requesting: draft.requesting,
      status: "open"
    });
    published = true;
  } finally {
    if (!published) {
      releaseTradeSlot(interaction.user.id, slot.cooldownUntil);
    }
  }

  drafts.delete(draft.id);
  await interaction.update({ content: "Your trade offer has been posted.", embeds: [], components: [] });
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
  clearTradeCooldown(trade.ownerId);

  await interaction.update({
    content: "",
    embeds: [buildTradeEmbed(trade.ownerId, trade.cardType, sending, requesting, true)],
    components: []
  });
}

function getOwnedDraft(ownerId: string, draftId: string): TradeDraft | undefined {
  const draft = drafts.get(draftId);
  return draft?.ownerId === ownerId ? draft : undefined;
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

client.login(token);
