import fs from "node:fs/promises";
import path from "node:path";

const outFile = path.join(process.cwd(), "dist", "index.js");
const shebang = "#!/usr/bin/env node\n";

const content = await fs.readFile(outFile, "utf8");
if (!content.startsWith(shebang)) {
  await fs.writeFile(outFile, shebang + content, "utf8");
}
