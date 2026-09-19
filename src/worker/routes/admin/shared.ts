// 管理端各域路由共用的请求小件（原 admin.ts 内部函数，增量 15 拆分时提出）
export function nowSql() {
  return "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
}

export async function readJson(c: { req: { raw: Request } }): Promise<unknown> {
  return c.req.raw.json().catch(() => null);
}
