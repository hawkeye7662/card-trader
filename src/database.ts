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

  CREATE TABLE IF NOT EXISTS bot_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS trades_owner_status_created_at
    ON trades (owner_id, status, created_at DESC);

  CREATE INDEX IF NOT EXISTS trades_owner_created_at
    ON trades (owner_id, created_at DESC);
`);

const cooldownPolicyMigration = database
  .prepare("INSERT OR IGNORE INTO bot_metadata (key, value) VALUES (?, ?)")
  .run("close-cooldown-policy-v1", new Date().toISOString());
if (cooldownPolicyMigration.changes === 1) {
  database.prepare("DELETE FROM trade_cooldowns").run();
}

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
  return row ? toTrade(row) : undefined;
}

export function closeTrade(id: string): boolean {
  return (
    database
      .prepare("UPDATE trades SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
      .run(new Date().toISOString(), id).changes === 1
  );
}

export function closeAllOpenTrades(ownerId: string): Trade[] {
  return database.transaction(() => {
    const rows = database
      .prepare("SELECT * FROM trades WHERE owner_id = ? AND status = 'open' ORDER BY created_at DESC")
      .all(ownerId) as TradeRow[];
    if (!rows.length) {
      return [];
    }

    const closedAt = new Date().toISOString();
    const close = database.prepare("UPDATE trades SET status = 'closed', closed_at = ? WHERE id = ?");
    for (const row of rows) {
      close.run(closedAt, row.id);
    }

    return rows.map((row) => toTrade({ ...row, status: "closed", closed_at: closedAt }));
  })();
}

export function closeExcessOpenTrades(ownerId: string, maximumOpenTrades: number): Trade[] {
  return database.transaction(() => {
    const rows = database
      .prepare("SELECT * FROM trades WHERE owner_id = ? AND status = 'open' ORDER BY created_at DESC")
      .all(ownerId) as TradeRow[];
    const excessRows = rows.slice(maximumOpenTrades);
    if (!excessRows.length) {
      return [];
    }

    const closedAt = new Date().toISOString();
    const close = database.prepare("UPDATE trades SET status = 'closed', closed_at = ? WHERE id = ?");
    for (const row of excessRows) {
      close.run(closedAt, row.id);
    }

    return excessRows.map((row) => toTrade({ ...row, status: "closed", closed_at: closedAt }));
  })();
}

export function closeAllExcessOpenTrades(maximumOpenTrades: number): Trade[] {
  const owners = database
    .prepare("SELECT owner_id FROM trades WHERE status = 'open' GROUP BY owner_id HAVING COUNT(*) > ?")
    .all(maximumOpenTrades) as { owner_id: string }[];
  return owners.flatMap((owner) => closeExcessOpenTrades(owner.owner_id, maximumOpenTrades));
}

export function getClosedTrades(): Trade[] {
  const rows = database
    .prepare("SELECT * FROM trades WHERE status = 'closed' ORDER BY closed_at DESC")
    .all() as TradeRow[];
  return rows.map(toTrade);
}

export function countOpenTrades(ownerId: string): number {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM trades WHERE owner_id = ? AND status = 'open'")
    .get(ownerId) as { count: number };
  return row.count;
}

export function countRecentTrades(ownerId: string, windowMs: number): number {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM trades WHERE owner_id = ? AND created_at >= ?")
    .get(ownerId, cutoff) as { count: number };
  return row.count;
}

export function hasRecentIdenticalTrade(
  ownerId: string,
  cardType: CardType,
  sending: readonly string[],
  requesting: readonly string[],
  windowMs: number
): boolean {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const rows = database
    .prepare("SELECT sending_json, requesting_json FROM trades WHERE owner_id = ? AND card_type = ? AND created_at >= ?")
    .all(ownerId, cardType, cutoff) as { sending_json: string; requesting_json: string }[];
  const normalizedSending = normalizeCardIds(sending);
  const normalizedRequesting = normalizeCardIds(requesting);

  return rows.some(
    (row) =>
      normalizeCardIds(JSON.parse(row.sending_json) as string[]) === normalizedSending &&
      normalizeCardIds(JSON.parse(row.requesting_json) as string[]) === normalizedRequesting
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
    .map(toTrade)
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

export function getTradeCooldown(ownerId: string): number | undefined {
  const row = database
    .prepare("SELECT cooldown_until FROM trade_cooldowns WHERE owner_id = ?")
    .get(ownerId) as { cooldown_until: number } | undefined;
  return row && row.cooldown_until > Date.now() ? row.cooldown_until : undefined;
}

export function setTradeCooldown(ownerId: string, cooldownMs: number): void {
  database
    .prepare(`
      INSERT INTO trade_cooldowns (owner_id, cooldown_until)
      VALUES (?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET cooldown_until = excluded.cooldown_until
    `)
    .run(ownerId, Date.now() + cooldownMs);
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

function toTrade(row: TradeRow): Trade {
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

function normalizeCardIds(cardIds: readonly string[]): string {
  return [...cardIds].sort().join(",");
}
