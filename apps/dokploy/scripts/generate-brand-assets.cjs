// @ts-nocheck
const fs = require('fs');
const path = require('path');
let sharp;
try {
  sharp = require('sharp');
} catch {
  try {
    sharp = require('c:/Users/hosting/dokploy/node_modules/.pnpm/sharp@0.35.4_@types+node@24.10.13/node_modules/sharp');
  } catch (err) {
    console.error('Could not load sharp:', err);
    process.exit(1);
  }
}

const publicDir = path.join(__dirname, '..', 'public');
const logoIconPath = path.join(publicDir, 'logo-icon.png');
const logoPath = path.join(publicDir, 'logo.png');

async function generateAssets() {
  console.log('Generating brand favicons and Open Graph assets...');

  if (!fs.existsSync(logoIconPath)) {
    throw new Error('logo-icon.png not found');
  }

  // 1. Generate resized PNG favicons
  const png16 = await sharp(logoIconPath).resize(16, 16).png().toBuffer();
  const png32 = await sharp(logoIconPath).resize(32, 32).png().toBuffer();
  const png48 = await sharp(logoIconPath).resize(48, 48).png().toBuffer();
  const png180 = await sharp(logoIconPath).resize(180, 180).png().toBuffer();
  const png192 = await sharp(logoIconPath).resize(192, 192).png().toBuffer();
  const png512 = await sharp(logoIconPath).resize(512, 512).png().toBuffer();

  fs.writeFileSync(path.join(publicDir, 'favicon-16x16.png'), png16);
  fs.writeFileSync(path.join(publicDir, 'favicon-32x32.png'), png32);
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), png48);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png180);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon-precomposed.png'), png180);
  fs.writeFileSync(path.join(publicDir, 'android-chrome-192x192.png'), png192);
  fs.writeFileSync(path.join(publicDir, 'android-chrome-512x512.png'), png512);

  // 2. Build multi-resolution ICO file (16x16, 32x32, 48x48)
  const images = [
    { size: 16, buffer: png16 },
    { size: 32, buffer: png32 },
    { size: 48, buffer: png48 },
  ];

  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = images.length;
  let offset = headerSize + numImages * dirEntrySize;

  const icoHeader = Buffer.alloc(headerSize);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
  icoHeader.writeUInt16LE(numImages, 4); // Number of images

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.size, 0); // Width
    entry.writeUInt8(img.size, 1); // Height
    entry.writeUInt8(0, 2);        // Color count
    entry.writeUInt8(0, 3);        // Reserved
    entry.writeUInt16LE(1, 4);     // Color planes
    entry.writeUInt16LE(32, 6);    // Bits per pixel
    entry.writeUInt32LE(img.buffer.length, 8); // Size in bytes
    entry.writeUInt32LE(offset, 12);           // Data offset
    dirEntries.push(entry);
    offset += img.buffer.length;
  }

  const icoBuffer = Buffer.concat([
    icoHeader,
    ...dirEntries,
    ...images.map(img => img.buffer)
  ]);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);
  console.log(`✓ Generated standard multi-res favicon.ico (${icoBuffer.length} bytes, 16/32/48px)`);

  // 3. Generate site.webmanifest
  const manifest = {
    name: 'HatDot Cloud',
    short_name: 'HatDot',
    description: 'Deploy Instantly. Scale Effortlessly. Own Your Cloud.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#0284c7',
    icons: [
      {
        src: '/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png'
      },
      {
        src: '/favicon-32x32.png',
        sizes: '32x32',
        type: 'image/png'
      },
      {
        src: '/favicon-16x16.png',
        sizes: '16x16',
        type: 'image/png'
      }
    ]
  };
  fs.writeFileSync(path.join(publicDir, 'site.webmanifest'), JSON.stringify(manifest, null, 2));
  console.log('✓ Generated site.webmanifest');

  // 4. Generate SVG icons
  const iconBase64 = png512.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${iconBase64}" width="512" height="512" preserveAspectRatio="xMidYMid meet" />
</svg>
`;
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg);
  fs.writeFileSync(path.join(publicDir, 'icon-dark.svg'), svg);
  fs.writeFileSync(path.join(publicDir, 'icon-light.svg'), svg);
  fs.writeFileSync(path.join(publicDir, 'logo.svg'), svg);
  console.log('✓ Generated icon.svg, icon-dark.svg, icon-light.svg, logo.svg');

  // 5. Generate high-resolution 1200x630 Open Graph (og.png) card for social sharing
  // Resize logo-icon for embedding into OG preview
  const ogIconSize = 160;
  const ogIconPng = await sharp(logoIconPath).resize(ogIconSize, ogIconSize).png().toBuffer();

  const ogSvgOverlay = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <!-- Background Gradient -->
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#09090b" />
        <stop offset="50%" stop-color="#0f172a" />
        <stop offset="100%" stop-color="#021324" />
      </linearGradient>
      <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#38bdf8" />
        <stop offset="50%" stop-color="#0284c7" />
        <stop offset="100%" stop-color="#0369a1" />
      </linearGradient>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0369a1" />
        <stop offset="100%" stop-color="#0284c7" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="60" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <!-- Base Canvas Background -->
    <rect width="1200" height="630" fill="url(#bg)" />

    <!-- Ambient Glow Spots -->
    <circle cx="200" cy="180" r="180" fill="#0284c7" opacity="0.18" filter="url(#glow)" />
    <circle cx="1020" cy="460" r="220" fill="#0369a1" opacity="0.15" filter="url(#glow)" />

    <!-- Card Container -->
    <rect x="50" y="50" width="1100" height="530" rx="24" fill="#0f172a" fill-opacity="0.65" stroke="#1e293b" stroke-width="2" />

    <!-- Top Badge -->
    <g transform="translate(100, 105)">
      <rect width="210" height="34" rx="17" fill="#0369a1" fill-opacity="0.3" stroke="#0284c7" stroke-width="1.5" />
      <circle cx="18" cy="17" r="5" fill="#38bdf8" />
      <text x="32" y="22" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12" font-weight="700" fill="#38bdf8" letter-spacing="1.5">DEVELOPER CLOUD</text>
    </g>

    <!-- Platform Name -->
    <text x="100" y="220" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="72" font-weight="900" fill="#ffffff" letter-spacing="-1.5">
      HatDot <tspan fill="url(#primaryGrad)">Cloud</tspan>
    </text>

    <!-- Tagline -->
    <text x="100" y="280" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#e2e8f0" letter-spacing="-0.3">
      Deploy Instantly. Scale Effortlessly. Own Your Cloud.
    </text>

    <!-- Feature Description -->
    <text x="100" y="330" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="18" font-weight="400" fill="#94a3b8">
      Modern Platform for Applications, Managed Databases &amp; Docker Stacks.
    </text>

    <!-- Feature Tags -->
    <g transform="translate(100, 395)">
      <!-- Tag 1 -->
      <g>
        <rect width="180" height="42" rx="10" fill="#1e293b" stroke="#334155" stroke-width="1" />
        <text x="90" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle">⚡ Instant Deploys</text>
      </g>
      <!-- Tag 2 -->
      <g transform="translate(195, 0)">
        <rect width="210" height="42" rx="10" fill="#1e293b" stroke="#334155" stroke-width="1" />
        <text x="105" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle">🗄️ Managed Databases</text>
      </g>
      <!-- Tag 3 -->
      <g transform="translate(420, 0)">
        <rect width="180" height="42" rx="10" fill="#1e293b" stroke="#334155" stroke-width="1" />
        <text x="90" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle">🔒 Automatic SSL</text>
      </g>
      <!-- Tag 4 -->
      <g transform="translate(615, 0)">
        <rect width="190" height="42" rx="10" fill="#1e293b" stroke="#334155" stroke-width="1" />
        <text x="95" y="26" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle">🌐 Custom Domains</text>
      </g>
    </g>

    <!-- Footer URL & Security Note -->
    <g transform="translate(100, 510)">
      <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="20" font-weight="700" fill="#38bdf8" letter-spacing="-0.2">
        hatdot.cloud
      </text>
      <text x="160" y="-1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="14" font-weight="400" fill="#64748b">
        • Enterprise-Grade Infrastructure
      </text>
    </g>
  </svg>
  `;

  // Composite SVG background with brand logo icon on the right
  const ogCard = await sharp(Buffer.from(ogSvgOverlay))
    .composite([
      {
        input: ogIconPng,
        top: 150,
        left: 920,
      },
    ])
    .png({ quality: 95, compressionLevel: 8 })
    .toBuffer();

  fs.writeFileSync(path.join(publicDir, 'og.png'), ogCard);
  console.log(`✓ Generated 1200x630 HatDot Open Graph preview og.png (${ogCard.length} bytes)`);

  console.log('All brand favicons and Open Graph assets generated successfully!');
}

generateAssets().catch(err => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
