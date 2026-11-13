// CPU 队名后缀（玩家队 → CPU 反向转换，v6.84.0）
// 纯函数：server 预检与测试共用；半角 (CPU) 结尾，容忍尾随空格（赛事系统队名可能带空格）。

export const CPU_SUFFIX_RE = /\(CPU\)\s*$/;

/**
 * 建议队名 = 当前名 + '(CPU)'：已带后缀（含空格/尾随空格写法）不重复叠加，并统一去掉后缀前的空格。
 */
export function cpuSuffixName(name: string): string {
  const base = name.trim().replace(/\s*\(CPU\)\s*$/, '');
  if (!base) return '(CPU)';
  return `${base}(CPU)`;
}
