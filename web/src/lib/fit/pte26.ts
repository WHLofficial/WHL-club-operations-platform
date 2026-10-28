// PTE26「位置 × 角色/重心」对照表——自 WHL-tournament-management-system/shared/tactics.ts
// 提取的 PTE26 段（PTE26_RAW + parsePte + 两个类型，逐字未改）。完整战术码编解码器仍留在
// tour 仓，本仓 fit 权重表（./roleFit.ts）只需要它的 49 个「位置×角色」组合做防漏配守卫
// （web/src/lib/fit/roleFit.test.ts 钉住：ROLE_FIT 的键与 PTE26 全组合一一对应）。
export interface PteEntry {
  role: string;
  focus: string;
  eaId: number;
  vct: number | null;
}

export type PteMap = Record<string, PteEntry[]>;

const PTE26_RAW =
  "GK#GK/Defend=0,GK/Balanced=1,SK/Balanced=2,SK/Build-Up=3,BPK/Build-Up=4|LB#FB/Defend=0,FB/Balanced=1,WB/Balanced=2,WB/Support=3,FAB/Defend=4,FAB/Balanced=5,AWB/Support=6,AWB/Attack=7,FB/Versatile=8,IWB/Build-Up=9,IWB/Attack=10|RB#FB/Defend=0,FB/Balanced=1,WB/Balanced=2,WB/Support=3,FAB/Defend=4,FAB/Balanced=5,AWB/Support=6,AWB/Attack=7,FB/Versatile=8,IWB/Build-Up=9,IWB/Attack=10|CB#D/Defend=0,D/Balanced=1,S/Balanced=2,S/Aggressive=3,BPD/Defend=4,BPD/Build-Up=5,BPD/Aggressive=6,WDB/Defend=7,WDB/Aggressive=8,WDB/Support=9|CDM#CH/Defend=0,H/Defend=1,H/Ball-Winning=2,H/Roaming=3,DLP/Build-Up=4,DLP/Defend=5,DLP/Roaming=6,WH/Defend=7,WH/Build-Up=8,BC/Balanced=9|CM#BTB/Balanced=0,H/Defend=1,H/Ball-Winning=2,DLP/Build-Up=3,DLP/Defend=4,PL/Attack=5,PL/Roaming=6,HW/Attack=7,HW/Balanced=8,BTB/Ball-Winning=9,HW/Support=10|LM#W/Balanced=0,W/Attack=1,WP/Build-Up=2,WP/Attack=3,WM/Support=4,WM/Defend=5,IF/Balanced=6,IF/Attack=7,WM/Build-Up=8|RM#W/Balanced=0,W/Attack=1,WP/Build-Up=2,WP/Attack=3,WM/Support=4,WM/Defend=5,IF/Balanced=6,IF/Attack=7,WM/Build-Up=8|CAM#PL/Build-Up=0,PL/Balanced=1,PL/Roaming=2,SS/Attack=3,HW/Attack=4,HW/Balanced=5,C10/Attack=6,C10/Wide=7,HW/Roaming=8,C10/Versatile=9|LW#IF/Attack=0,IF/Balanced=1,IF/Roaming=2,W/Balanced=3,W/Attack=4,WP/Build-Up=5,WP/Attack=6,W/Versatile=7|RW#IF/Attack=0,IF/Balanced=1,IF/Roaming=2,W/Balanced=3,W/Attack=4,WP/Build-Up=5,WP/Attack=6,W/Versatile=7|ST#TF/Attack=0,TF/Balanced=1,TF/Wide=2,F9/Build-Up=3,PO/Attack=4,PO/Support=5,AF/Attack=6,AF/Support=7,AF/Versatile=8,F9/Attack=9,PO/Versatile=10";

function parsePte(raw: string): PteMap {
  const out: PteMap = {};
  for (const g of raw.split("|")) {
    const p = g.split("#");
    const grp: PteEntry[] = [];
    out[p[0]] = grp;
    for (const e of p[1].split(",")) {
      const rf = e.split("=");
      const ef = rf[1].split(":");
      const roles = rf[0].split("/");
      grp.push({
        role: roles[0],
        focus: roles[1],
        eaId: +ef[0],
        vct: ef.length > 1 ? +ef[1] : null,
      });
    }
  }
  return out;
}

export const PTE26: PteMap = parsePte(PTE26_RAW);
