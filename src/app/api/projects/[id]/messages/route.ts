import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const messages = await prisma.chatMessage.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "asc" },
    include: { version: { select: { id: true, summary: true } } },
  });

  return NextResponse.json(messages);
}
