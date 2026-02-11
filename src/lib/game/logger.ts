import { prisma } from "@/lib/db/prisma";

export async function logPlayerAction(
  playerId: string,
  type: string,
  content: string,
  changes?: Record<string, any>
) {
  try {
    await prisma.playerLog.create({
      data: {
        playerId,
        type,
        content,
        changes: changes ? (changes as any) : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to log player action:", error);
  }
}
