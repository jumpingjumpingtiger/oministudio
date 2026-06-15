import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { initProjectStorage } from "@/lib/storage";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      versions: {
        where: { isActive: true },
        take: 1,
      },
      _count: { select: { versions: true, assets: true } },
    },
  });

  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description } = body;

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || "",
    },
  });

  await initProjectStorage(project.id);

  return NextResponse.json(project, { status: 201 });
}
