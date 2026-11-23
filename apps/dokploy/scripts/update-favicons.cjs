const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const logoIconPath = path.join(publicDir, 'logo-icon.png');

if (fs.existsSync(logoIconPath)) {
  const png = fs.readFileSync(logoIconPath);
  
  // 1. Generate standard favicon.ico
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type 1
  header.writeUInt16LE(1, 4); // 1 image
  header.writeUInt8(0, 6);    // width 256
  header.writeUInt8(0, 7);    // height 256
  header.writeUInt8(0, 8);    // color count 0
  header.writeUInt8(0, 9);    // reserved
  header.writeUInt16LE(1, 10); // color planes
  header.writeUInt16LE(32, 12); // bpp 32
  header.writeUInt32LE(png.length, 14); // image size
  header.writeUInt32LE(22, 18); // offset 22
  const ico = Buffer.concat([header, png]);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), ico);
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), png);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), png);

  // 2. Generate brand SVG icons with embedded base64 data URI
  const b64 = png.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <image href="data:image/png;base64,${b64}" width="512" height="512" preserveAspectRatio="xMidYMid meet" />
</svg>
`;
  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg);
  fs.writeFileSync(path.join(publicDir, 'icon-dark.svg'), svg);
  fs.writeFileSync(path.join(publicDir, 'icon-light.svg'), svg);
  console.log('Successfully generated favicon.ico, favicon.png, apple-touch-icon.png, icon.svg, icon-dark.svg, icon-light.svg from brand logo-icon.png');
} else {
  console.error('logo-icon.png not found in public/');
}

