/** 复制文本到剪贴板，返回是否成功（调用方负责给用户反馈）。
 *
 *  优先异步 Clipboard API；不可用（非安全上下文、老 Safari、权限被拒）时退回
 *  临时 textarea + execCommand —— 管理后台常在 iframe / http 预览里打开，
 *  只写 `navigator.clipboard.writeText` 会在这些环境里直接抛。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的降级路径
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.top = '-1000px';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
