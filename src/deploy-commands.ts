import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { CARD_TYPES, CARD_CATALOG } from "./cards.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in .env.");
}

const command = new SlashCommandBuilder().setName("trade").setDescription("Create or close a Clash card trade offer");
for (const type of CARD_TYPES) {
  command.addSubcommand((subcommand) =>
    subcommand.setName(type).setDescription(`Create a ${CARD_CATALOG[type].label} trade offer`)
  );
}
command.addSubcommand((subcommand) =>
  subcommand.setName("close-all").setDescription("Close all of your open trade offers")
);
command.addSubcommand((subcommand) =>
  subcommand.setName("close").setDescription("Choose one of your open trade offers to close")
);
command.addSubcommand((subcommand) =>
  subcommand.setName("edit").setDescription("Choose one of your open trade offers to update")
);
command.addSubcommand((subcommand) =>
  subcommand.setName("find-matches").setDescription("Find matches for your open trade offers")
);

const clanLinkCommand = new SlashCommandBuilder()
  .setName("clan-link")
  .setDescription("Save the clan for your future trade offers")
  .addStringOption((option) =>
    option.setName("tag").setDescription("Clan tag, such as #ABC123").setRequired(true)
  );

const rest = new REST({ version: "10" }).setToken(token);
const route = process.env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(clientId, process.env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: [command.toJSON(), clanLinkCommand.toJSON()] });
console.log(`Registered commands ${process.env.DISCORD_GUILD_ID ? "for the development guild" : "globally"}.`);
