import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AttachmentBuilder } from "discord.js";
import { CARD_CATALOG, type Card, type CardType } from "./cards.js";

const WIDTH = 1200;
const HEIGHT = 630;
const SECTION_X = {
  want: 70,
  have: 650
};
const CARD_SIZE = 135;
const CARD_GAP = 15;

export async function renderTrade(type: CardType, sending: readonly Card[], requesting: readonly Card[]): Promise<AttachmentBuilder> {
  const category = CARD_CATALOG[type];
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");

  context.fillStyle = "#1a1619";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = category.accent;
  context.globalAlpha = 0.2;
  context.beginPath();
  context.arc(WIDTH / 2, -160, 600, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = "#ffffff";
  context.font = "bold 42px sans-serif";
  context.fillText("TRADE OFFER", 70, 82);
  context.font = "28px sans-serif";
  context.fillStyle = "#d2c9d0";
  context.fillText(category.label.toUpperCase(), 70, 124);

  await drawSection(context, "WANT", SECTION_X.want, requesting, category.accent);
  await drawSection(context, "HAVE", SECTION_X.have, sending, category.accent);
  drawArrow(context, requesting.length, sending.length);

  return new AttachmentBuilder(await canvas.encode("png"), { name: "trade.png" });
}

function drawArrow(context: SKRSContext2D, wantedCards: number, offeredCards: number): void {
  const wantedEnd = SECTION_X.want + wantedCards * CARD_SIZE + (wantedCards - 1) * CARD_GAP;
  const offeredStart = SECTION_X.have;
  const centerX = (wantedEnd + offeredStart) / 2;

  context.fillStyle = "#e9a236";
  context.beginPath();
  context.moveTo(centerX - 58, 315);
  context.lineTo(centerX - 3, 315);
  context.lineTo(centerX - 3, 280);
  context.lineTo(centerX + 57, 355);
  context.lineTo(centerX - 3, 430);
  context.lineTo(centerX - 3, 395);
  context.lineTo(centerX - 58, 395);
  context.closePath();
  context.fill();
}

async function drawSection(
  context: SKRSContext2D,
  label: string,
  x: number,
  cards: readonly Card[],
  accent: string
): Promise<void> {
  context.font = "bold 30px sans-serif";
  context.fillStyle = "#ffffff";
  context.fillText(label, x, 190);

  for (const [index, card] of cards.entries()) {
    const tileX = x + index * (CARD_SIZE + CARD_GAP);
    await drawCardTile(context, card, tileX, 220, CARD_SIZE, accent);
  }
}

async function drawCardTile(
  context: SKRSContext2D,
  card: Card,
  x: number,
  y: number,
  size: number,
  accent: string
): Promise<void> {
  context.fillStyle = accent;
  roundRect(context, x - 7, y - 7, size + 14, size + 14, 16);
  context.fill();
  context.fillStyle = "#302936";
  roundRect(context, x, y, size, size, 10);
  context.fill();

  const imagePath = card.imagePath ? resolve(process.cwd(), card.imagePath) : undefined;
  if (imagePath && existsSync(imagePath)) {
    const image = await loadImage(imagePath);
    context.drawImage(image, x, y, size, size);
  } else {
    context.fillStyle = "#ffffff";
    context.globalAlpha = 0.16;
    context.beginPath();
    context.arc(x + size / 2, y + 58, 42, 0, Math.PI * 2);
    context.fill();
    context.fillRect(x + 33, y + 102, 84, 35);
    context.globalAlpha = 1;
    context.fillStyle = "#ffffff";
    context.font = "bold 18px sans-serif";
    context.textAlign = "center";
    context.fillText(card.name.slice(0, 16), x + size / 2, y + size + 30);
    context.textAlign = "start";
  }
}

function roundRect(context: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}
