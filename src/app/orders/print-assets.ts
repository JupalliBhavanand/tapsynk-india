import QRCode from "qrcode";
import { initials, type OrderCard } from "./orders";

export const CARD_WIDTH = 85.6;
export const CARD_HEIGHT = 53.98;
const BLEED = 3;
const SAFE = 3;
export type Side = "front" | "back";

function xml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character] ?? "");
}

function colour(value: string, fallback: string) {
  return /^#[a-f\d]{6}$/i.test(value) ? value : fallback;
}

function line(text: string, x: number, y: number, size: number, fill: string, weight = 500, limit = 58) {
  const estimatedWidth = Array.from(text).length * size * 0.57;
  const adjustedSize = Math.min(size, limit / Math.max(estimatedWidth, 1) * size);
  return '<text x="' + x + '" y="' + y + '" fill="' + fill + '" font-family="Arial, sans-serif" font-size="' +
    adjustedSize + '" font-weight="' + weight + '">' + xml(text) + "</text>";
}

export function qrVector(url: string, x = 0, y = 0, size = 256) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const span = modules.size + quiet * 2;
  const segments: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) segments.push("M" + (col + quiet) + " " + (row + quiet) + "h1v1h-1z");
    }
  }
  return '<svg x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" viewBox="0 0 ' + span + " " + span +
    '"><rect width="100%" height="100%" fill="#fff"/><path fill="#101828" d="' + segments.join("") + '"/></svg>';
}

export function svgUrl(svg: string) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export function cardSvg(
  order: OrderCard,
  side: Side,
  { bleed = false, guides = false, logo }: { bleed?: boolean; guides?: boolean; logo?: string } = {},
) {
  const design = order.cardDesign;
  const background = colour(design.backgroundColor, "#141629");
  const text = colour(design.textColor, "#FFFFFF");
  const accent = colour(design.accentColor, "#A59BFA");
  const margin = bleed ? BLEED : 0;
  const width = CARD_WIDTH + margin * 2;
  const height = CARD_HEIGHT + margin * 2;
  const art = design.template === "stripe"
    ? '<path d="M60 -3H89V57H41Z" fill="' + accent + '" opacity=".10"/><path d="M68 -3H89V57H50Z" fill="' + accent + '" opacity=".18"/>'
    : design.template === "frame"
      ? '<rect x="4" y="4" width="77.6" height="45.98" rx="2.2" fill="none" stroke="' + accent + '" opacity=".43" stroke-width=".45"/>'
      : '<circle cx="88" cy="12" r="26" fill="' + accent + '" opacity=".12"/><circle cx="88" cy="12" r="20" fill="none" stroke="' + accent + '" opacity=".42" stroke-width=".45"/>';
  const mark = logo && /^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(logo)
    ? '<image x="8" y="7" width="12" height="11" preserveAspectRatio="xMidYMid meet" href="' + logo + '"/>'
    : '<rect x="8" y="7" width="11" height="11" rx="2.5" fill="' + accent + '" opacity=".2"/>' +
      line(initials(order.name), 9.7, 14.4, 4.2, text, 700, 7.6);

  const face = side === "front"
    ? mark + line(order.name, 8, 33, 7, text, 700, 69) +
      line(order.role, 8, 40, 3.5, text, 500, 67) +
      line(order.company, 8, 45, 3.2, accent, 700, 66) +
      '<path d="M71 11q4 3.5 0 7m3-8.5q5.5 5 0 10m3-11.5q7 6.5 0 13" stroke="' +
      accent + '" stroke-width=".7" stroke-linecap="round" fill="none"/>'
    : mark + line(order.company, 8, 29, 5.1, text, 700, design.showQrOnBack ? 44 : 69) +
      line(design.showQrOnBack ? "Scan to connect" : "Tap to connect", 8, 36, 3.6, accent, 700) +
      line(order.profileSlug, 8, 41, 3.1, text, 500, 45) +
      (design.showQrOnBack ? qrVector(order.profileUrl, 54, 16, 24) : "");
  const guideMarks = guides
    ? '<rect x="0" y="0" width="85.6" height="53.98" fill="none" stroke="#FB7185" stroke-width=".35" stroke-dasharray="1.4 1"/>' +
      '<rect x="' + SAFE + '" y="' + SAFE + '" width="79.6" height="47.98" fill="none" stroke="#67E8F9" stroke-width=".3" stroke-dasharray="1.3 1"/>'
    : "";

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + 'mm" height="' + height +
    'mm" viewBox="' + [-margin, -margin, width, height].join(" ") + '"><rect x="' + (-margin) +
    '" y="' + (-margin) + '" width="' + width + '" height="' + height +
    '" fill="' + background + '"/>' + art + face + guideMarks + "</svg>";
}

export async function loadCardLogo(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Logo could not be loaded.");
  const blob = await response.blob();
  if (!/^image\/(?:png|jpeg|webp)$/.test(blob.type) || blob.size > 2_000_000) {
    throw new Error("Logo must be a PNG, JPEG, or WebP under 2 MB.");
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Logo could not be read."));
    reader.readAsDataURL(blob);
  });
}

export function saveFile(data: BlobPart, filename: string, type?: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function densityChunk(dpi: number) {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // pHYs
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  view.setUint32(8, pixelsPerMetre);
  view.setUint32(12, pixelsPerMetre);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const value of chunk.slice(4, 17)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

export async function printPng(svg: string) {
  const dpi = 300;
  const image = new Image();
  image.src = svgUrl(svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((CARD_WIDTH + BLEED * 2) / 25.4 * dpi);
  canvas.height = Math.round((CARD_HEIGHT + BLEED * 2) / 25.4 * dpi);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("PNG rendering is unavailable.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG export failed.")), "image/png");
  });
  const bytes = new Uint8Array(await png.arrayBuffer());
  // Replace the browser's default resolution with the actual print density.
  const chunks: BlobPart[] = [bytes.slice(0, 33), densityChunk(dpi)];
  const view = new DataView(bytes.buffer);
  for (let offset = 33; offset + 12 <= bytes.length;) {
    const end = offset + view.getUint32(offset) + 12;
    if (view.getUint32(offset + 4) !== 0x70485973) chunks.push(bytes.slice(offset, end));
    offset = end;
  }
  return new Blob(chunks, { type: "image/png" });
}

export async function downloadQr(order: OrderCard, orderNumber: string) {
  const canvas = await QRCode.toCanvas(order.profileUrl, { width: 960, margin: 4, errorCorrectionLevel: "M" });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("QR export failed.")), "image/png");
  });
  saveFile(blob, printFilename(orderNumber, order) + "-nfc-qr.png");
}


export function printFilename(orderNumber: string, card: OrderCard) {
  return (orderNumber + "-" + card.profileSlug).replace(/[^a-z0-9_-]/gi, "");
}
