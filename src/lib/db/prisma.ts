/**
 * Prisma 客户端单例
 *
 * Prisma 7.x 需要驱动适配器（不再自动读 DATABASE_URL）。
 * 使用 @prisma/adapter-pg + pg 驱动连接 PostgreSQL。
 */

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

/* eslint-disable @typescript-eslint/no-explicit-any */
const globalForPrisma = globalThis as unknown as {
  __prisma: any;
};

function createPrismaClient() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10, // 限制连接数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // 保活：防止云端 DB 在 LLM 长时间流式调用期间断开空闲连接
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  const adapter = new PrismaPg(pool);
  return new (PrismaClient as any)({ adapter }) as InstanceType<typeof PrismaClient>;
}

export const prisma: InstanceType<typeof PrismaClient> =
  globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
