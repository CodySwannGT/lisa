// Builds falsification controls from the current workflow (CodySwannGT/lisa#4671).
//  - mutation-reverted: the 3rd postgres service (mutation job) reverted to the old image line
//  - mysql-leak: a mysql service rewired to read database_image
//  - default-nonempty: database_image default changed from '' to 'postgres:16'
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(".github/workflows/quality-rails.yml", "utf8");
const out = path.join(__dirname, "..", "controls");
const NEW = "image: ${{ inputs.database_image || format('postgres:{0}', inputs.database_version || '16') }}";
const OLD = "image: postgres:${{ inputs.database_version || '16' }}";
const parts = src.split(NEW);
if (parts.length !== 4) throw new Error(`expected 3 occurrences, found ${parts.length - 1}`);
const mutationReverted = parts[0] + NEW + parts[1] + NEW + parts[2] + OLD + parts[3];
fs.writeFileSync(path.join(out, "quality-rails.mutation-reverted.yml"), mutationReverted);
const MY = "image: mysql:${{ inputs.database_version || '8.0' }}";
const i = src.indexOf(MY);
if (i < 0) throw new Error("mysql image line not found");
const mysqlLeak =
  src.slice(0, i) +
  "image: ${{ inputs.database_image || format('mysql:{0}', inputs.database_version || '8.0') }}" +
  src.slice(i + MY.length);
fs.writeFileSync(path.join(out, "quality-rails.mysql-leak.yml"), mysqlLeak);
const declRe = /(database_image:\n(?:.*\n)*?\s+default: )''/;
if (!declRe.test(src)) throw new Error("database_image default not found");
fs.writeFileSync(
  path.join(out, "quality-rails.default-nonempty.yml"),
  src.replace(declRe, "$1'postgres:16'"),
);
console.log("controls written");
