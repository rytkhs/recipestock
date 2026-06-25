export type ImageDimensions = {
  width: number;
  height: number;
};

const unsupportedImageFormatError = () => new Error("Image format is not supported.");
const imageDimensionsError = () => new Error("Image dimensions could not be determined.");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const EXIF_SIGNATURE = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] as const;

const hasBytes = (body: Uint8Array, offset: number, bytes: readonly number[]) =>
  bytes.every((byte, index) => body[offset + index] === byte);

const hasAscii = (body: Uint8Array, offset: number, value: string) =>
  [...value].every((character, index) => body[offset + index] === character.charCodeAt(0));

const ensureRange = (body: Uint8Array, offset: number, length: number) => {
  if (offset < 0 || length < 0 || offset + length > body.byteLength) {
    throw imageDimensionsError();
  }
};

const readUint16BE = (body: Uint8Array, offset: number) => {
  ensureRange(body, offset, 2);
  return (body[offset] << 8) | body[offset + 1];
};

const readUint16LE = (body: Uint8Array, offset: number) => {
  ensureRange(body, offset, 2);
  return body[offset] | (body[offset + 1] << 8);
};

const readUint24LE = (body: Uint8Array, offset: number) => {
  ensureRange(body, offset, 3);
  return body[offset] | (body[offset + 1] << 8) | (body[offset + 2] << 16);
};

const readUint32BE = (body: Uint8Array, offset: number) => {
  ensureRange(body, offset, 4);
  return (
    body[offset] * 0x1000000 + (body[offset + 1] << 16) + (body[offset + 2] << 8) + body[offset + 3]
  );
};

const readUint32LE = (body: Uint8Array, offset: number) => {
  ensureRange(body, offset, 4);
  return (
    body[offset] + (body[offset + 1] << 8) + (body[offset + 2] << 16) + body[offset + 3] * 0x1000000
  );
};

const assertDimensions = ({ width, height }: ImageDimensions): ImageDimensions => {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw imageDimensionsError();
  }

  return { width, height };
};

const getPngDimensions = (body: Uint8Array): ImageDimensions => {
  ensureRange(body, 0, 33);

  if (
    !hasBytes(body, 0, PNG_SIGNATURE) ||
    readUint32BE(body, 8) !== 13 ||
    !hasAscii(body, 12, "IHDR")
  ) {
    throw imageDimensionsError();
  }

  return assertDimensions({
    width: readUint32BE(body, 16),
    height: readUint32BE(body, 20),
  });
};

const isJpegSofMarker = (marker: number) =>
  (marker >= 0xc0 && marker <= 0xc3) ||
  (marker >= 0xc5 && marker <= 0xc7) ||
  (marker >= 0xc9 && marker <= 0xcb) ||
  (marker >= 0xcd && marker <= 0xcf);

const isStandaloneJpegMarker = (marker: number) =>
  marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);

const readTiffUint16 = (body: Uint8Array, offset: number, littleEndian: boolean) =>
  littleEndian ? readUint16LE(body, offset) : readUint16BE(body, offset);

const readTiffUint32 = (body: Uint8Array, offset: number, littleEndian: boolean) =>
  littleEndian ? readUint32LE(body, offset) : readUint32BE(body, offset);

const getExifOrientation = (body: Uint8Array, offset: number, length: number) => {
  const end = offset + length;
  if (length < 14 || !hasBytes(body, offset, EXIF_SIGNATURE)) {
    return null;
  }

  const tiffOffset = offset + EXIF_SIGNATURE.length;
  ensureRange(body, tiffOffset, 8);

  const littleEndian =
    body[tiffOffset] === 0x49 && body[tiffOffset + 1] === 0x49
      ? true
      : body[tiffOffset] === 0x4d && body[tiffOffset + 1] === 0x4d
        ? false
        : null;

  if (littleEndian === null || readTiffUint16(body, tiffOffset + 2, littleEndian) !== 42) {
    return null;
  }

  const ifdOffset = readTiffUint32(body, tiffOffset + 4, littleEndian);
  const ifdStart = tiffOffset + ifdOffset;
  if (ifdStart + 2 > end) {
    return null;
  }

  const entryCount = readTiffUint16(body, ifdStart, littleEndian);
  const entriesStart = ifdStart + 2;

  for (let index = 0; index < entryCount; index++) {
    const entryOffset = entriesStart + index * 12;
    if (entryOffset + 12 > end) {
      return null;
    }

    const tag = readTiffUint16(body, entryOffset, littleEndian);
    const type = readTiffUint16(body, entryOffset + 2, littleEndian);
    const count = readTiffUint32(body, entryOffset + 4, littleEndian);

    if (tag === 0x0112 && type === 3 && count === 1) {
      return readTiffUint16(body, entryOffset + 8, littleEndian);
    }
  }

  return null;
};

const getJpegDimensions = (body: Uint8Array): ImageDimensions => {
  ensureRange(body, 0, 4);

  if (body[0] !== 0xff || body[1] !== 0xd8) {
    throw imageDimensionsError();
  }

  let offset = 2;
  let orientation: number | null = null;

  while (offset < body.byteLength) {
    while (offset < body.byteLength && body[offset] !== 0xff) {
      offset++;
    }

    while (offset < body.byteLength && body[offset] === 0xff) {
      offset++;
    }

    if (offset >= body.byteLength) {
      break;
    }

    const marker = body[offset];
    offset++;

    if (marker === 0x00) {
      continue;
    }

    if (marker === 0xd9) {
      break;
    }

    if (isStandaloneJpegMarker(marker)) {
      continue;
    }

    const segmentLength = readUint16BE(body, offset);
    if (segmentLength < 2) {
      throw imageDimensionsError();
    }

    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > body.byteLength) {
      throw imageDimensionsError();
    }

    if (marker === 0xe1 && orientation === null) {
      orientation = getExifOrientation(body, segmentStart, segmentLength - 2);
    }

    if (isJpegSofMarker(marker)) {
      if (segmentLength < 7) {
        throw imageDimensionsError();
      }

      const dimensions = {
        width: readUint16BE(body, segmentStart + 3),
        height: readUint16BE(body, segmentStart + 1),
      };

      if (orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8) {
        return assertDimensions({ width: dimensions.height, height: dimensions.width });
      }

      return assertDimensions(dimensions);
    }

    offset = segmentEnd;
  }

  throw imageDimensionsError();
};

const getWebpVp8xDimensions = (body: Uint8Array, offset: number, length: number) => {
  if (length < 10) {
    throw imageDimensionsError();
  }

  return assertDimensions({
    width: readUint24LE(body, offset + 4) + 1,
    height: readUint24LE(body, offset + 7) + 1,
  });
};

const getWebpVp8lDimensions = (body: Uint8Array, offset: number, length: number) => {
  if (length < 5 || body[offset] !== 0x2f) {
    throw imageDimensionsError();
  }

  return assertDimensions({
    width: 1 + (((body[offset + 2] & 0x3f) << 8) | body[offset + 1]),
    height:
      1 +
      (((body[offset + 4] & 0x0f) << 10) |
        (body[offset + 3] << 2) |
        ((body[offset + 2] & 0xc0) >> 6)),
  });
};

const getWebpVp8Dimensions = (body: Uint8Array, offset: number, length: number) => {
  if (
    length < 10 ||
    (body[offset] & 0x01) !== 0 ||
    body[offset + 3] !== 0x9d ||
    body[offset + 4] !== 0x01 ||
    body[offset + 5] !== 0x2a
  ) {
    throw imageDimensionsError();
  }

  return assertDimensions({
    width: readUint16LE(body, offset + 6) & 0x3fff,
    height: readUint16LE(body, offset + 8) & 0x3fff,
  });
};

const getWebpDimensions = (body: Uint8Array): ImageDimensions => {
  ensureRange(body, 0, 12);

  if (!hasAscii(body, 0, "RIFF") || !hasAscii(body, 8, "WEBP")) {
    throw imageDimensionsError();
  }

  const riffSize = readUint32LE(body, 4);
  const riffEnd = 8 + riffSize;
  if (riffSize < 4 || riffEnd > body.byteLength) {
    throw imageDimensionsError();
  }

  let offset = 12;

  while (offset + 8 <= riffEnd) {
    const chunkType = String.fromCharCode(
      body[offset],
      body[offset + 1],
      body[offset + 2],
      body[offset + 3],
    );
    const chunkLength = readUint32LE(body, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    const paddedChunkEnd = chunkEnd + (chunkLength % 2);

    if (chunkLength === 0 || paddedChunkEnd > riffEnd) {
      throw imageDimensionsError();
    }

    switch (chunkType) {
      case "VP8X":
        return getWebpVp8xDimensions(body, chunkStart, chunkLength);
      case "VP8L":
        return getWebpVp8lDimensions(body, chunkStart, chunkLength);
      case "VP8 ":
        return getWebpVp8Dimensions(body, chunkStart, chunkLength);
    }

    offset = paddedChunkEnd;
  }

  throw imageDimensionsError();
};

export const getImageDimensions = (body: Uint8Array): ImageDimensions => {
  if (body.byteLength >= 8 && hasBytes(body, 0, PNG_SIGNATURE)) {
    return getPngDimensions(body);
  }

  if (body.byteLength >= 2 && body[0] === 0xff && body[1] === 0xd8) {
    return getJpegDimensions(body);
  }

  if (body.byteLength >= 12 && hasAscii(body, 0, "RIFF") && hasAscii(body, 8, "WEBP")) {
    return getWebpDimensions(body);
  }

  throw unsupportedImageFormatError();
};
