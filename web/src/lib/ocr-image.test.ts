// @vitest-environment jsdom
// v6.51.5 截图识别 · 上传前 2× 放大（尺寸算法 + canvas 路径与全部退回分支）。
// v6.51.11 重编码改 JPEG 0.92（识别结果与 PNG 逐行相同、体积 1/5）：正常路径与降质档随之调整。
// 测试计划：docs/test-plans/v6.51.5-ocr-image-upscale.md（TC-IMG）、v6.51.11-*.md。
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCR_JPEG_FALLBACK_QUALITY,
  OCR_JPEG_QUALITY,
  OCR_MAX_DECODED_BYTES,
  decodedBase64Bytes,
  fileToOcrBase64,
  ocrUpscaleTarget,
} from './ocr-image.ts';

/** 生成「解码后约 bytes 字节」的 base64 字符串（内容不重要，只看长度判定）。 */
const payloadOf = (bytes: number): string => 'A'.repeat(Math.ceil((bytes * 4) / 3));

function stubBitmap(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  return bitmap;
}

function stubCanvas(png: string, jpeg: string, jpegLow: string = jpeg, drawImage = vi.fn()) {
  const ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockImplementation((type?: string, quality?: number) => {
      if (type === 'image/jpeg') return `data:image/jpeg;base64,${quality === OCR_JPEG_FALLBACK_QUALITY ? jpegLow : jpeg}`;
      return `data:image/png;base64,${png}`;
    });
  return { ctx, toDataURL, drawImage };
}

const png = (): File => new File(['xy'], 'a.png', { type: 'image/png' });
/** File(['xy']) 经 FileReader 得到的 base64（即未放大时的兜底值）。 */
const RAW = 'eHk=';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TC-IMG 上传前 2× 放大（v6.51.5）', () => {
  it('TC-IMG-01 尺寸算法：2× 放大、最长边封顶 4096、不缩小、非法尺寸原样', () => {
    expect(ocrUpscaleTarget(1920, 1080)).toEqual({ width: 3840, height: 2160, scale: 2 });
    expect(ocrUpscaleTarget(640, 360)).toEqual({ width: 1280, height: 720, scale: 2 });
    const capped = ocrUpscaleTarget(3000, 2000);
    expect(capped.width).toBe(4096);
    expect(capped.height).toBe(2731);
    expect(capped.scale).toBeCloseTo(4096 / 3000, 6);
    expect(ocrUpscaleTarget(4096, 2160)).toEqual({ width: 4096, height: 2160, scale: 1 });
    expect(ocrUpscaleTarget(5000, 3000)).toEqual({ width: 5000, height: 3000, scale: 1 });
    expect(ocrUpscaleTarget(0, 1080)).toEqual({ width: 0, height: 0, scale: 1 });
    expect(ocrUpscaleTarget(Number.NaN, 1080)).toEqual({ width: 0, height: 0, scale: 1 });
  });

  it('TC-IMG-02 解码字节数按 4 字符 → 3 字节估算（估算偏大，只会更保守）', () => {
    expect(decodedBase64Bytes('')).toBe(0);
    expect(decodedBase64Bytes('AAAA')).toBe(3);
    expect(decodedBase64Bytes('A'.repeat(400))).toBe(300);
  });

  it('TC-IMG-03 正常路径：按 2× 目标尺寸画到 canvas，返回 JPEG 0.92 base64（无 data: 前缀）', async () => {
    const bitmap = stubBitmap(1920, 1080);
    const small = payloadOf(1024);
    const { drawImage, toDataURL } = stubCanvas(payloadOf(1024), small);
    await expect(fileToOcrBase64(png())).resolves.toBe(small);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 3840, 2160);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', OCR_JPEG_QUALITY);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('TC-IMG-04 JPEG 0.92 超服务端上限 → 降到 0.8 重编码（v6.51.11）', async () => {
    stubBitmap(1920, 1080);
    const low = payloadOf(2048);
    const { toDataURL } = stubCanvas('', payloadOf(OCR_MAX_DECODED_BYTES + 200_000), low);
    await expect(fileToOcrBase64(png())).resolves.toBe(low);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', OCR_JPEG_QUALITY);
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', OCR_JPEG_FALLBACK_QUALITY);
  });

  it('TC-IMG-05 两档 JPEG 都超上限 → 退回原图，不阻断上传', async () => {
    stubBitmap(1920, 1080);
    const huge = payloadOf(OCR_MAX_DECODED_BYTES + 200_000);
    stubCanvas(huge, huge, huge);
    await expect(fileToOcrBase64(png())).resolves.toBe(RAW);
  });

  it('TC-IMG-06 环境不支持 createImageBitmap（jsdom 默认）→ 原图直传', async () => {
    expect(typeof createImageBitmap).toBe('undefined');
    await expect(fileToOcrBase64(png())).resolves.toBe(RAW);
  });

  it('TC-IMG-07 createImageBitmap 解码失败 → 原图直传，不抛给上层', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));
    await expect(fileToOcrBase64(png())).resolves.toBe(RAW);
  });

  it('TC-IMG-08 原图已到 4096 长边 → 不放大也不缩小，原图直传', async () => {
    const bitmap = stubBitmap(5000, 3000);
    stubCanvas(payloadOf(1024), payloadOf(1024));
    await expect(fileToOcrBase64(png())).resolves.toBe(RAW);
    expect(bitmap.close).toHaveBeenCalled();
  });
});
