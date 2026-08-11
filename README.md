# Clash Card Trading Bot

A Discord.js bot for posting Clash card trade offers. Members run `/trade elixir`, `/trade dark-elixir`, `/trade builder-base`, or `/trade super-troop`, choose up to nine cards per side from private multi-select menus, then publish a rendered trade card. They can instead request every card they are not offering. Only the creator can close an offer, individually or with `/trade close-all`, and `/trade find-matches` privately lists matches for their open offers.

Run `/clan-link tag:#YOURTAG` to save a clan for future offers. Those offers include a **Join Clan** link button pointing to the official Clash clan profile.

## Trade limits

- Up to 3 open trades per player.
- Posting a new offer for a card type closes that player's existing open offer(s) of the same type.
- Up to 3 total posts per player in any rolling 30-minute period.
- An identical offer cannot be posted again for 30 minutes, including after it is closed.

## Trade threads

The bot creates and reuses one public `Read Only` thread for each card type in
every trading channel. Each trade is posted in the main channel and mirrored
to its type thread without pinging the trader. It needs **Create Public
Threads** and **Send Messages in Threads** permissions; grant **Manage
Threads** as well so it can reopen an archived type thread.

## Setup

1. Install Node.js 22 or newer, then run `npm install`.
2. Copy `.env.example` to `.env` and fill in the Discord application ID and bot token.
3. In the Discord Developer Portal, enable the **Guilds** scope for the bot and invite it with the `bot` and `applications.commands` scopes.
4. For instant development command updates, set `DISCORD_GUILD_ID`; otherwise commands register globally and can take up to an hour to appear.
5. Run `npm run deploy-commands`, then `npm start`.

## Card catalog and artwork

Edit `src/cards.ts` to replace the placeholder names and IDs. Put a PNG or WebP file for each card in `assets/cards/` and set that card's `imagePath` (for example, `assets/cards/elixir-archer.png`). Add `all.webp` in each category folder for large “want all other cards” requests. Missing artwork deliberately renders as a polished placeholder tile, so the bot works before assets are ready.

Trade records are stored in `data/trades.sqlite`, allowing Close Trade buttons to survive bot restarts.

## License and attribution

This project is licensed under the GNU General Public License v3.0 only
(GPL-3.0-only).

Card artwork in `assets/cards/` is sourced from
[ClashKing Assets](https://github.com/ClashKingInc/ClashKingAssets), licensed
under GPL-3.0. Credit: ClashKing Inc. The artwork is used unchanged unless
otherwise noted.
