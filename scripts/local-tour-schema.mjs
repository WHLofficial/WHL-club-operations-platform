#!/usr/bin/env node
// 本地 dev 的「赛事库」副本（TOUR_DB=whl）schema 补丁（v6.45.0 建）。
//
// 背景：`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` 里的 whl 副本是早期手工种下的快照，
// 停在赛事系统很多代之前的 schema（match 没有 note/leg、match_event 没有 entry_id/created_at、
// tournament 没有 config_json）。v6.45.0 起成长录入台要按赛事仓停赛引擎同口径复算停赛，
// 这几列缺一列就会让面板/补录端点 500（本地开发与 e2e ⑭ 都会踩到；线上 TOUR_DB 是当前
// schema，不受影响）。这里按「缺什么补什么」把本地副本抬到当前 schema，可反复执行。
//
// 用法：node scripts/local-tour-schema.mjs [persistRoot...]
//   默认补 .wrangler/state 与 .wrangler/rehearsal 两个持久化目录（存在才补）。
//   只动本地 miniflare sqlite 文件，绝不碰远端。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['.wrangler/state', '.wrangler/rehearsal'];

/** 目标列：表 → [列名, 类型]（赛事系统当前 schema 里 v6.45.0 用到的那几列） */
const COLUMNS = {
  match: [
    ['note', 'TEXT'],
    ['leg', 'INTEGER'],
  ],
  match_event: [
    ['entry_id', 'INTEGER'],
    ['created_at', 'TEXT'],
  ],
  tournament: [['config_json', 'TEXT']],
};

/** 补列后回填：事件归属的 entry（按同赛事同队推）、事件时间（回落比赛结束时间） */
const BACKFILL = [
  `UPDATE match_event SET entry_id = (
     SELECT e.id FROM match m
     JOIN stage s ON s.id = m.stage_id
     JOIN entry e ON e.tournament_id = s.tournament_id AND e.team_id = p.team_id
     JOIN player p ON p.id = match_event.player_id
     WHERE m.id = match_event.match_id LIMIT 1
   ) WHERE entry_id IS NULL`,
  `UPDATE match_event SET created_at = (
     SELECT m.finished_at FROM match m WHERE m.id = match_event.match_id
   ) WHERE created_at IS NULL`,
];

const tables = (db) =>
  new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
const cols = (db, t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));

function patch(file) {
  const db = new DatabaseSync(file);
  try {
    const t = tables(db);
    if (!t.has('match') || !t.has('match_event') || !t.has('tournament')) return null; // 不是赛事库
    const added = [];
    for (const [table, list] of Object.entries(COLUMNS)) {
      const have = cols(db, table);
      for (const [name, type] of list) {
        if (have.has(name)) continue;
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
        added.push(`${table}.${name}`);
      }
    }
    if (added.length === 0) return { added, backfilled: 0 };
    let backfilled = 0;
    for (const sql of BACKFILL) backfilled += db.prepare(sql).run().changes ?? 0;
    return { added, backfilled };
  } finally {
    db.close();
  }
}

let touched = 0;
for (const root of ROOTS) {
  const dir = join(root, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) {
    console.log(`— ${dir}（不存在，跳过）`);
    continue;
  }
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')) {
    const file = join(dir, name);
    const out = patch(file);
    if (!out) continue; // 平台库（whl-club）没有这三张表，正常跳过
    touched += 1;
    if (out.added.length === 0) {
      console.log(`✓ ${file} 已是当前 schema`);
    } else {
      console.log(`+ ${file} 补列：${out.added.join(', ')}（回填事件归属/时间 ${out.backfilled} 行）`);
    }
  }
}
console.log(touched === 0 ? '没有找到本地赛事库副本（先 npm run dev 生成 .wrangler/state）' : `完成，赛事库副本 ${touched} 个`);
