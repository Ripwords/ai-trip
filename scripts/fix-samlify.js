// Fix samlify's require('camelcase') which fails with ESM-only camelcase v7+
// Replace with inline implementation in ALL files that use it
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { join } from "path"

const SAMLIFY_DIR = "node_modules/samlify/build"

const INLINE_CAMELCASE = `var camelcase_1 = __importDefault(function(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/(?:^\\w|[A-Z]|\\b\\w)/g, function(word, index) {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/[\\s_-]+/g, '');
  });`

function walkDir(dir) {
  const files = []
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        files.push(...walkDir(full))
      } else if (full.endsWith(".js")) {
        files.push(full)
      }
    }
  } catch {
    /* dir doesn't exist */
  }
  return files
}

let patched = 0
for (const file of walkDir(SAMLIFY_DIR)) {
  let content = readFileSync(file, "utf8")
  if (content.includes('require("camelcase")')) {
    content = content.replace(
      /var camelcase_1 = __importDefault\(require\("camelcase"\)\);/g,
      INLINE_CAMELCASE,
    )
    writeFileSync(file, content)
    patched++
    console.log(`[fix-samlify] Patched: ${file}`)
  }
}

if (patched === 0) {
  console.log("[fix-samlify] No files needed patching (already patched or samlify not found)")
} else {
  console.log(`[fix-samlify] Patched ${patched} file(s)`)
}
