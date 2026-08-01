import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardType } from "./cards.js";

const rootDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath = join(rootDirectory, "..", "data", "trades.sqlite");

mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    guild_id TEXT,
    owner_id TEXT NOT NULL,
    card_type TEXT NOT NULL,
    sending_json TEXT NOT NULL,
    requesting_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
    created_at TEXT NOT NULL,
    closed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS player_clans (
    owner_id TEXT PRIMARY KEY,
    clan_tag TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trade_cooldowns (
    owner_id TEXT PRIMARY KEY,
    cooldown_until INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trade_match_notifications (
    trade_id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    channel_id TEXT NOT NULL
  );
`);

export interface Trade {
  id: string;
  messageId: string;
  channelId: string;
  guildId: string | null;
  ownerId: string;
  cardType: CardType;
  sending: string[];
  requesting: string[];
  status: "open" | "closed";
  closedAt: string | null;
}

interface TradeRow {
  id: string;
  message_id: string;
  channel_id: string;
  guild_id: string | null;
  owner_id: string;
  card_type: CardType;
  sending_json: string;
  requesting_json: string;
  status: "open" | "closed";
  closed_at: string | null;
}

export function createTrade(trade: Trade): void {
  database
    .prepare(`
      INSERT INTO trades (
        id, message_id, channel_id, guild_id, owner_id, card_type,
        sending_json, requesting_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `)
    .run(
      trade.id,
      trade.messageId,
      trade.channelId,
      trade.guildId,
      trade.ownerId,
      trade.cardType,
      JSON.stringify(trade.sending),
      JSON.stringify(trade.requesting),
      new Date().toISOString()
    );
}

export function getTrade(id: string): Trade | undefined {
  const row = database.prepare("SELECT * FROM trades WHERE id = ?").get(id) as TradeRow | undefined;
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    messageId: row.message_id,
    channelId: row.channel_id,
    guildId: row.guild_id,
    ownerId: row.owner_id,
    cardType: row.card_type,
    sending: JSON.parse(row.sending_json) as string[],
    requesting: JSON.parse(row.requesting_json) as string[],
    status: row.status,
    closedAt: row.closed_at
  };
}

export function closeTrade(id: string): boolean {
  return (
    database
      .prepare("UPDATE trades SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
      .run(new Date().toISOString(), id).changes === 1
  );
}

export function findCompatibleOpenTrades(
  guildId: string,
  ownerId: string,
  requestedCardIds: readonly string[],
  offeredCardIds: readonly string[]
): Trade[] {
  const requestedCards = new Set(requestedCardIds);
  const offeredCards = new Set(offeredCardIds);
  const rows = database
    .prepare("SELECT * FROM trades WHERE guild_id = ? AND owner_id != ? AND status = 'open' ORDER BY created_at DESC")
    .all(guildId, ownerId) as TradeRow[];

  const matchingTrades = rows
    .map((row) => ({
      id: row.id,
      messageId: row.message_id,
      channelId: row.channel_id,
      guildId: row.guild_id,
      ownerId: row.owner_id,
      cardType: row.card_type,
      sending: JSON.parse(row.sending_json) as string[],
      requesting: JSON.parse(row.requesting_json) as string[],
      status: row.status,
      closedAt: row.closed_at
    }))
    .filter(
      (trade) =>
        trade.sending.some((cardId) => requestedCards.has(cardId)) &&
        trade.requesting.some((cardId) => offeredCards.has(cardId))
    );

  const seenOwners = new Set<string>();
  return matchingTrades.filter((trade) => {
    if (seenOwners.has(trade.ownerId)) {
      return false;
    }
    seenOwners.add(trade.ownerId);
    return true;
  });
}

export function saveClanTag(ownerId: string, clanTag: string): void {
  database
    .prepare(`
      INSERT INTO player_clans (owner_id, clan_tag, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        clan_tag = excluded.clan_tag,
        updated_at = excluded.updated_at
    `)
    .run(ownerId, clanTag, new Date().toISOString());
}

export function getClanTag(ownerId: string): string | undefined {
  const row = database.prepare("SELECT clan_tag FROM player_clans WHERE owner_id = ?").get(ownerId) as
    | { clan_tag: string }
    | undefined;
  return row?.clan_tag;
}

export interface TradeSlotClaim {
  granted: boolean;
  cooldownUntil: number;
}

export function claimTradeSlot(ownerId: string, cooldownMs: number): TradeSlotClaim {
  const now = Date.now();
  const cooldownUntil = now + cooldownMs;
  const result = database
    .prepare(`
      INSERT INTO trade_cooldowns (owner_id, cooldown_until)
      VALUES (?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET cooldown_until = excluded.cooldown_until
      WHERE trade_cooldowns.cooldown_until <= ?
    `)
    .run(ownerId, cooldownUntil, now);

  if (result.changes === 1) {
    return { granted: true, cooldownUntil };
  }

  const row = database
    .prepare("SELECT cooldown_until FROM trade_cooldowns WHERE owner_id = ?")
    .get(ownerId) as { cooldown_until: number };
  return { granted: false, cooldownUntil: row.cooldown_until };
}

export function releaseTradeSlot(ownerId: string, cooldownUntil: number): void {
  database
    .prepare("DELETE FROM trade_cooldowns WHERE owner_id = ? AND cooldown_until = ?")
    .run(ownerId, cooldownUntil);
}

export function clearTradeCooldown(ownerId: string): void {
  database.prepare("DELETE FROM trade_cooldowns WHERE owner_id = ?").run(ownerId);
}

export interface TradeMatchNotification {
  messageId: string;
  channelId: string;
}

export function saveTradeMatchNotification(tradeId: string, messageId: string, channelId: string): void {
  database
    .prepare("INSERT OR REPLACE INTO trade_match_notifications (trade_id, message_id, channel_id) VALUES (?, ?, ?)")
    .run(tradeId, messageId, channelId);
}

export function getTradeMatchNotification(tradeId: string): TradeMatchNotification | undefined {
  const row = database
    .prepare("SELECT message_id, channel_id FROM trade_match_notifications WHERE trade_id = ?")
    .get(tradeId) as { message_id: string; channel_id: string } | undefined;

  return row ? { messageId: row.message_id, channelId: row.channel_id } : undefined;
}

export function deleteTradeMatchNotification(tradeId: string): void {
  database.prepare("DELETE FROM trade_match_notifications WHERE trade_id = ?").run(tradeId);
}
