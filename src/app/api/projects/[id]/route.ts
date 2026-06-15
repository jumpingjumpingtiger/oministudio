import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...(body.name && { name: body.name.trim() }),
      ...(body.description !== undefined && { description: body.description.trim() }),
    },
  });

  return NextResponse.json(project);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.project.delete({ where: { id } });

  const dataDir = path.join(process.cwd(), ".data", "project");
  const codeDir = path.join(dataDir, "code", id);
  const assetsDir = path.join(dataDir, "assets", id);

  if (existsSync(codeDir)) {
    await fs.rm(codeDir, { recursive: true, force: true });
  }
  if (existsSync(assetsDir)) {
    await fs.rm(assetsDir, { recursive: true, force: true });
  }

  return NextResponse.json({ success: true });
}
