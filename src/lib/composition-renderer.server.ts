import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { CompositionDesign } from "@/composition/model";
import { totalCompositionDuration } from "@/composition/model";
import { appwriteServer } from "@/integrations/appwrite/client.server";
import { fetchAppwriteRecording } from "@/integrations/appwrite/storage.server";

const executeFile = promisify(execFile);

type CompositionRenderInput = {
  exportId: string;
  rawRecordingFileId: string;
  rawDurationSeconds: number;
  composition: CompositionDesign;
};

function safeRenderDirectory(exportId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new Error("Render export identifier is invalid.");
  const workspaceRoot = resolve(process.cwd());
  const renderRoot = resolve(workspaceRoot, ".codex-tmp", "composition-renders");
  const artifactRoot = resolve(workspaceRoot, ".codex-tmp", "composition-artifacts");
  const jobDirectory = resolve(renderRoot, exportId);
  const artifactFile = resolve(artifactRoot, `${exportId}.mp4`);
  if (!jobDirectory.startsWith(`${renderRoot}${sep}`)) {
    throw new Error("Render directory escaped the WiseDemo workspace.");
  }
  if (!artifactFile.startsWith(`${artifactRoot}${sep}`)) {
    throw new Error("Render artifact escaped the WiseDemo workspace.");
  }
  return { workspaceRoot, renderRoot, jobDirectory, artifactRoot, artifactFile };
}

export async function renderCompositionToMp4(input: CompositionRenderInput): Promise<{
  bytes: Uint8Array;
  outputDuration: number;
}> {
  const { workspaceRoot, jobDirectory, artifactRoot, artifactFile } = safeRenderDirectory(
    input.exportId,
  );
  const publicDirectory = resolve(jobDirectory, "public");
  const bundleDirectory = resolve(jobDirectory, "bundle");
  const jobFile = resolve(jobDirectory, "job.json");
  const outputFile = resolve(jobDirectory, "output.mp4");

  const cached = await readFile(artifactFile).catch(() => null);
  if (cached && cached.byteLength >= 100_000) {
    return {
      bytes: new Uint8Array(cached),
      outputDuration: totalCompositionDuration(input.composition, input.rawDurationSeconds),
    };
  }

  await mkdir(publicDirectory, { recursive: true });
  await cp(resolve(workspaceRoot, "public", "frames"), resolve(publicDirectory, "frames"), {
    recursive: true,
  });

  const { config } = appwriteServer();
  const raw = await fetchAppwriteRecording(config, input.rawRecordingFileId);
  if (!raw.ok) {
    await raw.body?.cancel().catch(() => undefined);
    throw new Error("The raw Appwrite recording could not be loaded for composition.");
  }
  await writeFile(resolve(publicDirectory, "source.mp4"), new Uint8Array(await raw.arrayBuffer()));

  const inputProps = {
    composition: input.composition,
    rawVideoUrl: "source.mp4",
    rawVideoIsStatic: true,
    rawDurationSeconds: input.rawDurationSeconds,
  };
  await writeFile(
    jobFile,
    JSON.stringify({ inputProps, publicDir: publicDirectory, bundleDir: bundleDirectory }),
    "utf8",
  );

  try {
    try {
      await executeFile(
        process.execPath,
        [resolve(workspaceRoot, "scripts", "render-composition.mjs"), jobFile, outputFile],
        {
          cwd: workspaceRoot,
          timeout: 20 * 60_000,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string };
      const diagnostic = String(failure.stderr || failure.stdout || failure.message).slice(-4_000);
      console.error("[WiseDemo] composition worker diagnostic", diagnostic);
      throw new Error(`Video worker failed: ${diagnostic}`);
    }
    const bytes = new Uint8Array(await readFile(outputFile));
    if (bytes.byteLength < 100_000)
      throw new Error("The composition renderer returned an incomplete MP4.");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(artifactFile, bytes);
    return {
      bytes,
      outputDuration: totalCompositionDuration(input.composition, input.rawDurationSeconds),
    };
  } finally {
    await rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function clearCompositionRenderCache(exportId: string): Promise<void> {
  const { artifactFile } = safeRenderDirectory(exportId);
  await rm(artifactFile, { force: true });
}
