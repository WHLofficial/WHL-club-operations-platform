# 平台字体 union 子集生成（共享字体源 · 探索B 设计稿 §5.2 / §6 / ADR-6）：
# Noto Serif SC 600 → scripts/platform-fonts/output/v1/noto-serif-sc-600-union.woff2
#
# 字符集口径 = club ∪ tour ∪ guess 三份现脚本的源码扫描范围并集（逐仓 glob 照抄）+ auth 仓 src
# + 生产 20 支球队名 + Latin-1/Latin-Ext-A + 常用中文标点。
# 源码注释里的字也会带进来（测试文件、migrations、node_modules 不扫）——字符集宁宽勿窄，掉字比多几十 KB 难看。
#
# 四仓假设为同目录 sibling checkout（默认 C:/Users/bhdjb/whlProgram/ 下四仓，ADR-6 的假设），
# 可用 --club-root/--tour-root/--guess-root/--auth-root 逐仓覆盖；
# --*-root 只改「扫描字符用的根」，TTF 缓存与 inter/jbmono/OFL 拷贝源始终取脚本所在仓（club）。
#
# 依赖：pip install fonttools brotli
# 用法：
#   python scripts/build-platform-fonts.py                 # 缓存缺失时自动下载 14.8MB TTF
#   python scripts/build-platform-fonts.py --skip-download # 不下载，缓存缺失即报错
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# 脚本所在仓 = club 仓（脚本自身与 Latin 字体拷贝源都住在 club）
ROOT = Path(__file__).resolve().parent.parent
SIBLING = ROOT.parent
CACHE = ROOT / "scripts/.font-cache/NotoSerifSC_600SemiBold.ttf"
TTF_URL = (
    "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-serif-sc@0.4.4"
    "/600SemiBold/NotoSerifSC_600SemiBold.ttf"
)
FONTS_SRC = ROOT / "web/public/fonts"  # inter/jbmono 四件与三份 OFL 的拷贝来源
OUT_DIR = ROOT / "scripts/platform-fonts/output/v1"
UNION_OUT = OUT_DIR / "noto-serif-sc-600-union.woff2"
CHARS_FILE = OUT_DIR / "chars.txt"
MANIFEST = OUT_DIR / "MANIFEST.json"

# 生产库在线的球队名（本地 D1 只有测试数据，不能只靠扫本地数据取字）
CLUB_NAMES = [
    "AC米兰(CPU)", "RB莱比锡", "佛罗伦萨", "切尔西", "利物浦", "奥林匹亚科斯",
    "尤文图斯", "巴塞罗那", "巴黎圣日耳曼", "慕尼黑1860", "拜仁慕尼黑", "曼城(CPU)",
    "曼联", "皇家贝蒂斯", "皇家马德里", "纽卡斯尔联", "诺丁汉森林", "里昂",
    "阿斯顿维拉", "阿森纳",
]

# 逐仓扫描范围 = 各仓现脚本的 glob 照抄（club build-serif-subset.py / tour build-fonts.py /
# guess build-fonts.py），auth 仓按设计稿 ADR-6 并入其 src。
SCAN_BY_REPO = {
    "club": (
        "web/src/**/*.ts", "web/src/**/*.tsx", "web/src/**/*.css",
        "src/**/*.ts", "web/index.html",
    ),
    "tour": (
        "src/**/*.ts", "src/**/*.tsx", "src/**/*.css",
        "worker/**/*.ts", "shared/**/*.ts", "index.html",
    ),
    "guess": (
        "public/**/*.html", "public/**/*.js", "public/**/*.css",
        "src/**/*.ts", "cron-worker/**/*.ts",
    ),
    "auth": ("src/**/*.ts",),
}

# 从 club web/public/fonts/ 原样拷贝（四仓 sha256 逐字节相同的同一套文件，见设计稿 §1.2）
COPY_FILES = (
    "inter-latin.woff2", "inter-latin-ext.woff2",
    "jbmono-latin.woff2", "jbmono-latin-ext.woff2",
    "OFL-NotoSerifSC.txt", "OFL-Inter.txt", "OFL-JetBrainsMono.txt",
)

FILE_NOTES = {
    "noto-serif-sc-600-union.woff2":
        "Noto Serif SC 600 四仓并集子集（本脚本子集化）",
    "inter-latin.woff2": "@fontsource-variable/inter@5.2.5 files/inter-latin-wght-normal.woff2 原样拷贝",
    "inter-latin-ext.woff2": "@fontsource-variable/inter@5.2.5 files/inter-latin-ext-wght-normal.woff2 原样拷贝",
    "jbmono-latin.woff2": "@fontsource-variable/jetbrains-mono@5.2.5 files/jetbrains-mono-latin-wght-normal.woff2 原样拷贝",
    "jbmono-latin-ext.woff2": "@fontsource-variable/jetbrains-mono@5.2.5 files/jetbrains-mono-latin-ext-wght-normal.woff2 原样拷贝",
    "OFL-NotoSerifSC.txt": "SIL OFL 1.1 许可全文（Noto Serif SC）",
    "OFL-Inter.txt": "SIL OFL 1.1 许可全文（Inter）",
    "OFL-JetBrainsMono.txt": "SIL OFL 1.1 许可全文（JetBrains Mono）",
    "chars.txt": "union 字符表（pyftsubset --text-file 的输入）",
}


def cjk_count(text: str) -> int:
    return sum(1 for c in text if "\u4e00" <= c <= "\u9fff")


def collect_chars(roots: dict[str, Path]) -> str:
    missing = [f"{name}={root}" for name, root in roots.items() if not root.is_dir()]
    if missing:
        sys.exit(f"仓库目录不存在：{'、'.join(missing)}；四仓按 sibling 布局取默认值，可用 --*-root 覆盖")
    chars: set[str] = set()
    for name, root in roots.items():
        repo_chars: set[str] = set()
        for pattern in SCAN_BY_REPO[name]:
            for path in root.glob(pattern):
                if path.is_file():
                    # errors="ignore"：guess 仓的手写 JS 里偶有非 UTF-8 字节，缺字风险为 0（宁宽勿窄）
                    repo_chars |= set(path.read_text(encoding="utf-8", errors="ignore"))
        print(f"  {name:<5} 扫得 {len(repo_chars):>5} 字（CJK {cjk_count(''.join(repo_chars)):>4}）")
        chars |= repo_chars
    chars.update("".join(CLUB_NAMES))
    # ASCII + Latin-1 + Latin Extended-A：英文名、重音字母（Ø/Š/Đ/Ł）都在标题里出现过
    chars.update(chr(c) for c in range(0x20, 0x250))
    # 中文标点与界面符号（emoji 会被 pyftsubset 跳过，不影响）
    chars.update("·—–…“”‘’「」『』【】《》〈〉、。，；：？！（）％‰×÷±≤≥≠→←↑↓★☆")
    return "".join(sorted(c for c in chars if c.isprintable()))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def build_manifest(charset: str) -> None:
    entries = {}
    for path in sorted(OUT_DIR.iterdir()):
        if not path.is_file():
            continue
        note = FILE_NOTES.get(path.name, "")
        entries[path.name] = {
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
            "content_type": "font/woff2" if path.suffix == ".woff2" else "text/plain",
            "note": note,
        }
    manifest = {
        "version": "v1",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "charset": {"total": len(charset), "cjk": cjk_count(charset)},
        "description": (
            "四仓（club/tour/guess/auth）源码扫描并集 + 生产 20 队名 + Latin-1/Latin-Ext-A "
            "+ 中文标点的 Noto Serif SC 600 union 子集，及平台共享的 inter/jbmono 与 OFL 许可。"
            "生成命令：python scripts/build-platform-fonts.py（详见 scripts/platform-fonts/README.md）"
        ),
        "files": entries,
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="生成四仓并集平台字体（共享字体源 · 探索B）")
    parser.add_argument("--skip-download", action="store_true",
                        help="不下载 TTF，缓存缺失即报错（离线/网络受限环境用）")
    parser.add_argument("--club-root", type=Path, default=ROOT,
                        help=f"club 仓扫描根（默认 {ROOT}）")
    parser.add_argument("--tour-root", type=Path, default=SIBLING / "WHL-tournament-management-system",
                        help="tour 仓扫描根（默认 sibling 布局）")
    parser.add_argument("--guess-root", type=Path, default=SIBLING / "WHL-Daily-Activities-System",
                        help="guess 仓扫描根（默认 sibling 布局）")
    parser.add_argument("--auth-root", type=Path, default=SIBLING / "WHL-auth-service",
                        help="auth 仓扫描根（默认 sibling 布局）")
    args = parser.parse_args()
    roots = {
        "club": args.club_root, "tour": args.tour_root,
        "guess": args.guess_root, "auth": args.auth_root,
    }

    if not CACHE.exists():
        if args.skip_download:
            sys.exit(f"缓存缺失且 --skip-download：{CACHE}\n去掉 --skip-download 让脚本自动下载（jsDelivr）")
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"下载 {TTF_URL}")
        urllib.request.urlretrieve(TTF_URL, CACHE)
    missing_src = [name for name in COPY_FILES if not (FONTS_SRC / name).exists()]
    if missing_src:
        sys.exit(f"club 字体源缺失 {FONTS_SRC}：{'、'.join(missing_src)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("扫描四仓源码字符（glob 照抄各仓现脚本）：")
    chars = collect_chars(roots)
    CHARS_FILE.write_text(chars, encoding="utf-8")
    print(f"字符集 {len(chars)} 字（CJK {cjk_count(chars)}）→ {CHARS_FILE.relative_to(ROOT)}")

    cmd = [
        sys.executable, "-m", "fontTools.subset", str(CACHE),
        f"--text-file={CHARS_FILE}",
        f"--output-file={UNION_OUT}",
        "--flavor=woff2",
        # 只留排版必需的四个特性；vert/vrt2 等竖排特性用不到
        "--layout-features=kern,liga,locl,ccmp",
        "--glyph-names", "--symbol-cmap", "--legacy-cmap",
        "--notdef-glyph", "--notdef-outline", "--recommended-glyphs",
    ]
    subprocess.run(cmd, check=True)
    print(f"写出 {UNION_OUT.relative_to(ROOT)}（{UNION_OUT.stat().st_size:,} B）")

    for name in COPY_FILES:
        shutil.copy2(FONTS_SRC / name, OUT_DIR / name)
    print(f"拷贝 {len(COPY_FILES)} 件平台字体/许可 ← {FONTS_SRC.relative_to(ROOT)}/")

    build_manifest(chars)
    print(f"写出 {MANIFEST.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
