import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { DATA_DIR } from "./assets";

const execFileAsync = promisify(execFile);

export async function renderSlides(projectId: string, version: number, pptxBytes: Buffer, expectedSlides: number): Promise<string[]> {
  const outputDir = path.join(DATA_DIR, "renders", projectId, String(version));
  await mkdir(outputDir, { recursive: true });
  const cached = (await readdir(outputDir)).filter((name) => /^slide-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  if (cached.length === expectedSlides) return cached.map((name) => `/api/projects/${projectId}/render/${version}/${name}`);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slide-harness-"));
  try {
    const source = path.join(tempDir, "deck.pptx");
    await writeFile(source, pptxBytes);
    const profile = pathToFileURL(path.join(tempDir, "lo-profile")).href;
    await execFileAsync("libreoffice", [
      `-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", tempDir, source,
    ], { timeout: 60000, windowsHide: true });
    const pdf = path.join(tempDir, "deck.pdf");
    await execFileAsync("pdftoppm", ["-png", "-r", "120", pdf, path.join(outputDir, "slide")], { timeout: 60000, windowsHide: true });
    const names = (await readdir(outputDir)).filter((name) => /^slide-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (!names.length) throw new Error("出力プレビューを生成できませんでした。");
    return names.map((name) => `/api/projects/${projectId}/render/${version}/${name}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function renderPptxPreview(pptxBytes: Buffer): Promise<Buffer[]> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "slide-harness-vision-"));
  try {
    const source = path.join(tempDir, "deck.pptx");
    await writeFile(source, pptxBytes);
    const profile = pathToFileURL(path.join(tempDir, "lo-profile")).href;
    await execFileAsync("libreoffice", [
      `-env:UserInstallation=${profile}`, "--headless", "--convert-to", "pdf", "--outdir", tempDir, source,
    ], { timeout: 60000, windowsHide: true });
    const pdf = path.join(tempDir, "deck.pdf");
    await execFileAsync("pdftoppm", ["-png", "-r", "96", pdf, path.join(tempDir, "slide")], { timeout: 60000, windowsHide: true });
    const names = (await readdir(tempDir)).filter((name) => /^slide-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
    if (!names.length) throw new Error("視覚レビュー用プレビューを生成できませんでした。");
    return Promise.all(names.map((name) => readFile(path.join(tempDir, name))));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function readRenderedSlide(projectId: string, version: number, name: string): Promise<Buffer> {
  return readFile(path.join(DATA_DIR, "renders", projectId, String(version), name));
}
