import sharp from "sharp";
import type { ImageAssetFormat } from "@/lib/asset-format";
import { formatNeedsPngNormalize } from "@/lib/asset-format";
import { normalizePngBuffer } from "@/lib/engine/png-normalize";

/** Process raw Image LLM bytes into the target on-disk format. */
export async function processGeneratedImage(
  raw: Buffer,
  format: ImageAssetFormat
): Promise<Buffer> {
  if (formatNeedsPngNormalize(format)) {
    return (await normalizePngBuffer(raw, { claimsPng: true })).buffer;
  }

  return sharp(raw, { failOn: "error" }).jpeg({ quality: 92 }).toBuffer();
}
