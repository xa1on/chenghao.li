const fs = require('fs');
const {
  GEN_DIR,
  FS_MANIFEST_PATH,
  COMMANDS_INDEX_PATH,
  BUDDIES_PATH,
  buildVfsTree,
  generateManifestContent,
  generateCommandsIndexContent,
  generateBuddiesListContent
} = require('./cache_buster.js');

async function main() {
  if (!fs.existsSync(GEN_DIR)) {
    fs.mkdirSync(GEN_DIR, { recursive: true });
  }

  // 1. Generate Buddies List (must be done first as commands import it)
  const buddiesContent = generateBuddiesListContent();
  fs.writeFileSync(BUDDIES_PATH, buddiesContent, 'utf8');
  console.log(`Buddies list generated successfully in ${BUDDIES_PATH}`);

  // 2. Generate Commands Index
  const indexContent = await generateCommandsIndexContent();
  fs.writeFileSync(COMMANDS_INDEX_PATH, indexContent, 'utf8');
  console.log(`Commands index generated successfully in ${COMMANDS_INDEX_PATH}`);

  // 3. Generate Virtual File System Manifest
  const vfsTree = buildVfsTree('.');
  const manifestContent = generateManifestContent(vfsTree);
  fs.writeFileSync(FS_MANIFEST_PATH, manifestContent, 'utf8');
  console.log(`Virtual File System manifest generated successfully in ${FS_MANIFEST_PATH}`);
}

main().catch(console.error);
