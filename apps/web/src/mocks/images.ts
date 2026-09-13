// R2の代わりに、objectKeyから決まるプレースホルダ画像を組み立てる。
// 写真中心のレイアウトを見たいので、縦横比も色もキーごとにばらつかせる。

const palettes = [
  { base: "#e7d3b3", accent: "#c08a52", plate: "#f6efe3" },
  { base: "#d9e0cd", accent: "#7f9367", plate: "#f3f6ec" },
  { base: "#f0d7cd", accent: "#c1705c", plate: "#faeee9" },
  { base: "#dcd8ea", accent: "#7d74a6", plate: "#f1eff8" },
  { base: "#eadfc4", accent: "#b19334", plate: "#f8f2e0" },
];

const aspects = [
  { width: 1200, height: 900 },
  { width: 1080, height: 1080 },
  { width: 900, height: 1200 },
  { width: 1600, height: 900 },
];

const hashSeed = (seed: string) => {
  let hash = 5381;

  for (let position = 0; position < seed.length; position += 1) {
    hash = (hash * 33 + seed.charCodeAt(position)) % 2_147_483_647;
  }

  return hash;
};

export const imagePlaceholderSvg = (seed: string) => {
  const hash = hashSeed(seed);
  const palette = palettes[hash % palettes.length];
  const { width, height } = aspects[Math.floor(hash / 7) % aspects.length];
  const centerX = width / 2;
  const centerY = height / 2;
  const plateRadius = Math.min(width, height) * 0.32;
  const foodRadius = plateRadius * 0.62;
  const gradientId = `g${hash}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.base}"/>
      <stop offset="100%" stop-color="${palette.accent}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#${gradientId})"/>
  <circle cx="${centerX}" cy="${centerY}" r="${plateRadius}" fill="${palette.plate}" opacity="0.92"/>
  <circle cx="${centerX}" cy="${centerY}" r="${foodRadius}" fill="${palette.accent}" opacity="0.55"/>
</svg>`;
};
