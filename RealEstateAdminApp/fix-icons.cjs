const fs = require('fs');
let c = fs.readFileSync('src/icons/index.ts', 'utf8');
c = c.replace(/import \{ ReactComponent as ([a-zA-Z0-9_]+) \} from "(.*?)";/g, 'import $1 from "$2";');
fs.writeFileSync('src/icons/index.ts', c);
console.log("Fixed icons");
