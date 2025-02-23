const puppeteer = require("puppeteer");
const fs = require("fs");
const urls = require("./ad-Data/post-ad.json");
const config = require("./ad-Data/config.json");
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChatInputCommandInteraction,
  Client,
} = require("discord.js");

const cooldowns = new Set();
let sentIn = [];

module.exports = {
  data: new SlashCommandBuilder()
    .setName("post")
    .setDescription("Post messages"),

  /**
   * Main function to execute the slash command.
   * @param {Object} param0
   * @param {Client} param0.client
   * @param {ChatInputCommandInteraction} param0.interaction
   */
  run: async ({ client, interaction }) => {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "Run this command inside a server!",
        ephemeral: true,
      });
    }

    // Check for required role
    if (!interaction.member.roles.cache.has(config.staffRoleId)) {
      return interaction.reply({
        content: "You do not have permission to run this command.",
        ephemeral: true,
      });
    }

    // Prevent multiple simultaneous executions
    if (cooldowns.has("working")) {
      return interaction.reply({
        content: "Already posting ads, please wait.",
        ephemeral: true,
      });
    }

    const { logChannelId, messageChannelId } = config;
    const targetChannel =
      interaction.guild.channels.cache.get(messageChannelId);

    if (!targetChannel) {
      return interaction.reply({
        content: "The specified channel does not exist.",
        ephemeral: true,
      });
    }

    await interaction.reply({
      content: `Please send the ad content in the following channel: ${targetChannel}`,
      ephemeral: true,
    });

    const filter = (message) => message.author.id === interaction.user.id;
    const collector = targetChannel.createMessageCollector({
      filter,
      time: 600000,
    });

    collector.on("collect", async (message) => {
      if (cooldowns.has("working")) return;

      cooldowns.add("working");
      const adContent = message.content;
      let reply;

      try {
        reply = await message.reply("Starting to post ads...");
        await postAdWithPuppeteer(adContent);

        const embedChunks = chunkArray(sentIn, 30);

        for (const chunk of embedChunks) {
          const embed = new EmbedBuilder()
            .setAuthor({
              name: `${interaction.user.username}`,
              iconURL: interaction.user.displayAvatarURL(),
            })
            .setTitle("Ad Posting Complete")
            .setDescription(
              `Successfully sent ads to the following channels:\n${chunk.join(
                "\n"
              )}`
            )
            .setTimestamp();

          // Log success to the log channel
          const logChannel = interaction.guild.channels.cache.get(logChannelId);
          if (logChannel) {
            await logChannel.send({ embeds: [embed] });
          }
        }
        
        await interaction.followUp({
          content: "Ad has been successfully posted to all relevant channels.",
          ephemeral: true,
        });

        sentIn = []; // Clear sent channels after posting
        message.delete();
        reply.delete();
      } catch (error) {
        console.error("Error during ad posting:", error);

        await interaction.followUp({
          content:
            "An error occurred while posting the ad. Please try again later.",
          ephemeral: true,
        });

        if (reply) {
          setTimeout(() => reply.delete(), 30000); // Auto-delete error message
        }
      } finally {
        collector.stop();
      }
    });

    collector.on("end", () => {
      cooldowns.delete("working");
    });
  },
};

// Function to handle Puppeteer interactions
async function postAdWithPuppeteer(adContent) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  sentIn = []; // Clear previous session

  try {
    await page.setDefaultNavigationTimeout(60000);
    await page.goto("https://discord.com/login");

    const { email, password } = config;

    // Log in to Discord
    await page.type('input[name="email"]', email, { delay: 10 });
    await page.type('input[name="password"]', password, { delay: 10 });
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle2" });

    // Post to each channel
    for (const { guildId, channelId } of urls) {
      try {
        const channelURL = `https://discord.com/channels/${guildId}/${channelId}`;
        await page.goto(channelURL, { waitUntil: "networkidle2" });
        await page.waitForSelector('div[role="textbox"]');

        const lines = adContent.split("\n");
        for (const line of lines) {
          await page.type('div[role="textbox"]', line, { delay: 5 });
          await page.keyboard.down("Shift");
          await page.keyboard.press("Enter");
          await page.keyboard.up("Shift");
        }

        await page.keyboard.press("Enter");
        sentIn.push(channelURL);
      } catch (error) {
        console.error(
          `Error posting to channel: ${guildId}/${channelId}`,
          error
        );
      }
    }
  } catch (error) {
    console.error("Error during Puppeteer operation:", error);
  } finally {
    await browser.close();
  }
}

/**
 * Splits an array into chunks of a specified size.
 * @param {Array} array - The array to split.
 * @param {number} size - The size of each chunk.
 * @returns {Array[]} - The array split into chunks.
 */
function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}
