import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const [jobFile, outputFile] = process.argv.slice(2);
if (!jobFile || !outputFile) {
  throw new Error("Usage: render-composition.mjs <job.json> <output.mp4>");
}

const job = JSON.parse(await readFile(resolve(jobFile), "utf8"));
if (!job || typeof job !== "object" || !job.inputProps || !job.publicDir || !job.bundleDir) {
  throw new Error("Composition render job is invalid.");
}

const serveUrl = await bundle({
  entryPoint: resolve("src/composition/remotion-entry.tsx"),
  publicDir: resolve(job.publicDir),
  outDir: resolve(job.bundleDir),
  enableCaching: true,
  onProgress: (progress) => {
    if (progress === 1 || progress === 0 || Math.round(progress * 100) % 25 === 0) {
      console.info(`[WiseDemo render] bundle ${Math.round(progress * 100)}%`);
    }
  },
});

const composition = await selectComposition({
  serveUrl,
  id: "WiseDemoComposition",
  inputProps: job.inputProps,
  logLevel: "warn",
  timeoutInMilliseconds: 120_000,
  chromeMode: "headless-shell",
});

const qualityToCrf = { draft: 28, standard: 23, high: 18, master: 15 };
await renderMedia({
  serveUrl,
  composition,
  inputProps: job.inputProps,
  codec: "h264",
  outputLocation: resolve(outputFile),
  pixelFormat: "yuv420p",
  crf: qualityToCrf[job.inputProps.composition.export.quality] ?? 18,
  concurrency: 2,
  overwrite: true,
  logLevel: "warn",
  timeoutInMilliseconds: 120_000,
  chromeMode: "headless-shell",
  onProgress: ({ progress }) => {
    const percent = Math.round(progress * 100);
    if (percent === 100 || percent === 0 || percent % 10 === 0) {
      console.info(`[WiseDemo render] media ${percent}%`);
    }
  },
});

console.info(`[WiseDemo render] complete ${resolve(outputFile)}`);
