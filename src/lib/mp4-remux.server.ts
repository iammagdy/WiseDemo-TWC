import { BoxParser, createFile, type MP4BoxBuffer, type Sample } from "mp4box";

export class Mp4RemuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4RemuxError";
  }
}

function groupConsecutive(values: number[]): { counts: number[]; values: number[] } {
  const counts: number[] = [];
  const groupedValues: number[] = [];
  for (const value of values) {
    const last = groupedValues.length - 1;
    if (last >= 0 && groupedValues[last] === value) counts[last] = (counts[last] ?? 0) + 1;
    else {
      groupedValues.push(value);
      counts.push(1);
    }
  }
  return { counts, values: groupedValues };
}

function removeChildBox(
  parent: { boxes?: Array<{ type?: string }> },
  type: string,
): void {
  parent.boxes = (parent.boxes ?? []).filter((box) => box.type !== type);
  delete (parent as Record<string, unknown>)[type];
}

function requireSampleData(sample: Sample): Uint8Array<ArrayBuffer> {
  if (!sample.data || sample.data.byteLength !== sample.size) {
    throw new Mp4RemuxError("The fragmented MP4 is missing media sample data.");
  }
  return sample.data;
}

type RawBox = { offset: number; size: number; headerSize: number; type: string };

function readBoxes(bytes: Uint8Array, start = 0, end = bytes.byteLength): RawBox[] {
  const boxes: RawBox[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = start; offset + 8 <= end; ) {
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) size = end - offset;
    if (size < headerSize || offset + size > end) break;
    boxes.push({ offset, size, headerSize, type });
    offset += size;
  }
  return boxes;
}

function patchChunkOffsets(bytes: Uint8Array, trackByteLengths: number[]): void {
  const top = readBoxes(bytes);
  const mdat = top.find((box) => box.type === "mdat");
  if (!mdat) throw new Mp4RemuxError("MP4 writer omitted the media-data box.");
  const chunkTables: RawBox[] = [];
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  const visit = (start: number, end: number): void => {
    for (const box of readBoxes(bytes, start, end)) {
      if (box.type === "stco" || box.type === "co64") chunkTables.push(box);
      if (containers.has(box.type)) visit(box.offset + box.headerSize, box.offset + box.size);
    }
  };
  visit(0, bytes.byteLength);
  if (chunkTables.length !== trackByteLengths.length) {
    throw new Mp4RemuxError("MP4 writer produced an unexpected chunk-table layout.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let chunkOffset = mdat.offset + mdat.headerSize;
  for (let index = 0; index < chunkTables.length; index += 1) {
    const table = chunkTables[index];
    const trackByteLength = trackByteLengths[index];
    if (!table || trackByteLength === undefined) continue;
    const payload = table.offset + table.headerSize;
    if (view.getUint32(payload + 4) !== 1) {
      throw new Mp4RemuxError("MP4 writer produced more than one chunk per remuxed track.");
    }
    if (table.type === "co64") view.setBigUint64(payload + 8, BigInt(chunkOffset));
    else view.setUint32(payload + 8, chunkOffset);
    chunkOffset += trackByteLength;
  }
}

export function remuxFragmentedMp4(bytes: Uint8Array): Uint8Array {
  const source = bytes.slice().buffer as MP4BoxBuffer;
  source.fileStart = 0;
  const file = createFile(true);
  let parseError = "";
  file.onError = (module, message) => {
    parseError = `${module}: ${message}`;
  };
  file.appendBuffer(source, true);
  file.flush();
  if (parseError) throw new Mp4RemuxError(`MP4 parser rejected the recording (${parseError}).`);

  const info = file.getInfo();
  if (!info.hasMoov || !info.isFragmented || !info.tracks.length) {
    throw new Mp4RemuxError("The recording is not a complete fragmented MP4.");
  }
  const parsedBoxes = file.boxes;
  file.boxes = [file.ftyp, file.moov];
  file.getBuffer(); // Normalize parsed box sizes before rebuilding the sample tables.
  file.boxes = parsedBoxes;

  const movieTimescale = file.moov.mvhd.timescale || 1_000;
  let movieDuration = 0;
  const outputs = info.tracks.map((trackInfo) => {
    const track = file.getTrackById(trackInfo.id);
    const sampleInfo = file.getTrackSamplesInfo(trackInfo.id);
    if (!track || !sampleInfo?.length) {
      throw new Mp4RemuxError(`MP4 track ${trackInfo.id} contains no media samples.`);
    }
    const samples = sampleInfo.map((_, index) => file.getTrackSample(trackInfo.id, index));
    const sampleBytes = new Uint8Array(
      samples.reduce((total, sample) => total + sample.size, 0),
    );
    let byteOffset = 0;
    for (const sample of samples) {
      const data = requireSampleData(sample);
      sampleBytes.set(data, byteOffset);
      byteOffset += data.byteLength;
    }

    const sampleTable = track.mdia.minf.stbl;
    const durations = groupConsecutive(samples.map((sample) => sample.duration));
    sampleTable.stts.sample_counts = durations.counts;
    sampleTable.stts.sample_deltas = durations.values;
    sampleTable.stsc.first_chunk = [1];
    sampleTable.stsc.samples_per_chunk = [samples.length];
    sampleTable.stsc.sample_description_index = [1];
    sampleTable.stsz.sample_size = 0;
    sampleTable.stsz.sample_sizes = samples.map((sample) => sample.size);

    const compositionOffsets = samples.map((sample) => sample.cts - sample.dts);
    removeChildBox(sampleTable, "ctts");
    if (compositionOffsets.some((offset) => offset !== 0)) {
      const offsets = groupConsecutive(compositionOffsets);
      const ctts = new BoxParser.box.ctts();
      ctts.version = compositionOffsets.some((offset) => offset < 0) ? 1 : 0;
      ctts.sample_counts = offsets.counts;
      ctts.sample_offsets = offsets.values;
      sampleTable.addBox(ctts);
    }

    removeChildBox(sampleTable, "stss");
    const syncSampleNumbers = samples.flatMap((sample, index) =>
      sample.is_sync ? [index + 1] : [],
    );
    if (syncSampleNumbers.length !== samples.length) {
      const stss = new BoxParser.box.stss();
      stss.sample_numbers = syncSampleNumbers;
      sampleTable.addBox(stss);
    }

    const mediaDuration = samples.reduce((total, sample) => total + sample.duration, 0);
    track.mdia.mdhd.duration = mediaDuration;
    track.tkhd.duration = Math.ceil(
      (mediaDuration * movieTimescale) / track.mdia.mdhd.timescale,
    );
    movieDuration = Math.max(movieDuration, track.tkhd.duration);
    return { track, sampleBytes };
  });

  file.moov.mvhd.duration = movieDuration;
  removeChildBox(file.moov, "mvex");
  file.ftyp.compatible_brands = [
    ...new Set(
      [...file.ftyp.compatible_brands.filter((brand) => brand !== "hlsf"), "isom", "mp42"],
    ),
  ];

  const mediaData = new Uint8Array(
    outputs.reduce((total, output) => total + output.sampleBytes.byteLength, 0),
  );
  let mediaOffset = 0;
  for (const output of outputs) {
    mediaData.set(output.sampleBytes, mediaOffset);
    mediaOffset += output.sampleBytes.byteLength;
  }
  const mdat = new BoxParser.box.mdat();
  file.mdats = [mdat];
  file.moofs = [];

  // MP4Box.js writes a four-byte placeholder for an empty mdat. A one-byte
  // draft keeps the normal eight-byte mdat header so chunk offsets are exact.
  mdat.data = new Uint8Array(1);
  file.boxes = [file.ftyp, file.moov, mdat];
  const draft = file.getBuffer().buffer;
  const draftView = new DataView(draft);
  let boxOffset = 0;
  let trackByteOffset = 0;
  while (boxOffset + 8 <= draft.byteLength) {
    const size = draftView.getUint32(boxOffset);
    const type = String.fromCharCode(...new Uint8Array(draft, boxOffset + 4, 4));
    if (type === "mdat") {
      trackByteOffset = boxOffset + 8;
      break;
    }
    if (size < 8) break;
    boxOffset += size;
  }
  if (!trackByteOffset) throw new Mp4RemuxError("MP4 writer did not produce media data.");
  for (const output of outputs) {
    const sampleTable = output.track.mdia.minf.stbl;
    const chunkOffsets = sampleTable.stco ?? sampleTable.co64;
    if (!chunkOffsets) throw new Mp4RemuxError("MP4 track is missing a chunk-offset table.");
    chunkOffsets.chunk_offsets = [trackByteOffset];
    trackByteOffset += output.sampleBytes.byteLength;
  }

  mdat.data = mediaData;
  const result = new Uint8Array(file.getBuffer().buffer);
  patchChunkOffsets(
    result,
    outputs.map((output) => output.sampleBytes.byteLength),
  );
  if (!result.byteLength || result.byteLength > 500 * 1024 * 1024) {
    throw new Mp4RemuxError("The remuxed MP4 is empty or exceeds the 500 MB limit.");
  }
  return result;
}
