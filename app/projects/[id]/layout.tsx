import type { Metadata } from "next";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await getProject(id).catch(() => null);
  const title = project?.title ? `${project.title} | Slide Harness` : "資料 | Slide Harness";
  return { title, description: title };
}

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
