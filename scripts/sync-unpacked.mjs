import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('release/pack/win-unpacked');
const destDir = path.resolve('release/win-unpacked');
const packDir = path.resolve('release/pack');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true, force: true });
  try {
    fs.rmSync(packDir, { recursive: true, force: true });
  } catch {}
  console.log('✅ Unpacked 应用已同步就绪 -> release/win-unpacked/AstroLib.exe');
}
