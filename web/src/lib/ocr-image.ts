/**
 * v6.51.5 截图识别：上传前把截图等比放大 2×。
 *
 * 为什么：视觉模型对图像按像素切块计费与「看」——1920×1080 的原图送进去，表格里
 * 的姓名只占很小一块像素，模型会稳定误读相邻字母（实测 8 次调用逐字相同：
 * M. Carnesecchi → Carnesechi、A. Garnacho → Garmacho）。全图放大 2× 后同一批图
 * 4/4 全对，代价是输入 token 3.6k → 6.9k（仍在最便宜档）。
 * 不做裁切：实测裁掉右侧会连带丢掉队名区域（3/4 图 team 变「未知」），故只缩放。
 *
 * v6.51.11 重编码改 JPEG：2× 之后 PNG 是 2.3–3.7MB（base64 3.0–4.9MB），
 * 同样 3840×2160 的 JPEG 0.92 只有 0.57–0.71MB（≈1/5）——识别结果逐行相同
 * （5 张真图实测：4 张 Summary + 1 张 Goalkeeping，姓名/评分/进球/助攻零差异，
 * tab 与 teamRaw 一致），而模型耗时对体积不敏感（探针里 2.7MB 与 0.66MB 的
 * 调用耗时在噪声内），所以省下的是用户上行传输与 canvas 编码时间。
 * 代价：个别图的 team 中文字段会回英文原名（5 张里 1 张），由服务端 v6.51.8 的
 * FC26 英文名兜底分侧接住（19/20 队命中），队名真的认不出时仍有选边按钮。
 */

/** 放大倍数。2× 已能把 1920×1080 截图的两处固定误读压掉，再大只是多花 token。 */
export const OCR_UPSCALE_FACTOR = 2;
/** 放大后最长边上限：4K 截图再 ×2 会越过最低计费档，也逼近服务端 5MB 上限。 */
export const OCR_UPSCALE_MAX_SIDE = 4096;
/** 服务端 OCR_MAX_BYTES = 5MB（按解码字节算）；这里留裕量，超了降质 / 退回原图。 */
export const OCR_MAX_DECODED_BYTES = 4.5 * 1024 * 1024;
/** 2× 图的重编码质量（v6.51.11 起走 JPEG）：0.92 与 PNG 识别结果逐行相同，体积 1/5。 */
export const OCR_JPEG_QUALITY = 0.92;
/** 0.92 仍超上限时的降质档（正常 3840×2160 到不了，留着兜 4K 以上输入）。 */
export const OCR_JPEG_FALLBACK_QUALITY = 0.8;

export interface OcrUpscaleTarget {
  width: number;
  height: number;
  scale: number;
}

/** base64（无前缀）解码后的字节数：4 字符 → 3 字节。 */
export function decodedBase64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

/**
 * 纯尺寸计算：等比放大 factor 倍、最长边封顶 maxSide；
 * 已经是超长边（≥ 上限）的图不缩小，原样返回（scale 1）。
 */
export function ocrUpscaleTarget(
  width: number,
  height: number,
  factor: number = OCR_UPSCALE_FACTOR,
  maxSide: number = OCR_UPSCALE_MAX_SIDE,
): OcrUpscaleTarget {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, scale: 1 };
  }
  const longest = Math.max(width, height);
  const scale = Math.min(factor, maxSide / longest);
  if (!(scale > 1)) return { width, height, scale: 1 };
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

const stripPrefix = (dataUrl: string): string => dataUrl.replace(/^data:[^,]*,/, '');

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读文件失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 放大并重编码；任何一步不可用（无 createImageBitmap / 无 2d context / 图解不开 /
 * 重编码后仍超服务端上限）都返回 null，由调用方退回原图——识别链路不允许因为
 * 预处理失败而中断。
 */
async function upscaleToBase64(file: File): Promise<string | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height, scale } = ocrUpscaleTarget(bitmap.width, bitmap.height);
    if (scale <= 1) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = stripPrefix(canvas.toDataURL('image/jpeg', OCR_JPEG_QUALITY));
    if (decodedBase64Bytes(jpeg) <= OCR_MAX_DECODED_BYTES) return jpeg;
    const lower = stripPrefix(canvas.toDataURL('image/jpeg', OCR_JPEG_FALLBACK_QUALITY));
    if (decodedBase64Bytes(lower) <= OCR_MAX_DECODED_BYTES) return lower;
    return null;
  } finally {
    bitmap.close?.();
  }
}

/**
 * 截图文件 → 送 OCR 端点的纯 base64（剥 data: 前缀）。
 * 先在浏览器里 2× 放大（见文件头），放大不可用时原样返回文件内容。
 */
export async function fileToOcrBase64(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const raw = stripPrefix(dataUrl);
  try {
    return (await upscaleToBase64(file)) ?? raw;
  } catch {
    return raw;
  }
}
