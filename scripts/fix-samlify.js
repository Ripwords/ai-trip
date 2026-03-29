// Fix samlify's require('camelcase') which fails with ESM-only camelcase v7+
// Replace with inline implementation to avoid the dependency entirely
import { readFileSync, writeFileSync, existsSync } from 'fs';

const file = 'node_modules/samlify/build/src/extractor.js';

if (!existsSync(file)) {
  console.log('[fix-samlify] samlify not found, skipping');
  process.exit(0);
}

let content = readFileSync(file, 'utf8');

if (content.includes("require(\"camelcase\")")) {
  content = content.replace(
    /var camelcase_1 = __importDefault\(require\("camelcase"\)\);/,
    `var camelcase_1 = __importDefault(function(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/(?:^\\w|[A-Z]|\\b\\w)/g, function(word, index) {
      return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/[\\s_-]+/g, '');
  });`
  );
  writeFileSync(file, content);
  console.log('[fix-samlify] Patched camelcase require() -> inline function');
} else {
  console.log('[fix-samlify] Already patched or require not found');
}
