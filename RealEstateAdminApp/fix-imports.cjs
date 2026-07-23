const fs = require('fs');
const path = require('path');
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.resolve(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      results.push(file);
    }
  });
  return results;
}
walk('./src').filter(f => f.endsWith('.tsx') || f.endsWith('.ts')).forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  let newContent = content.replace(/from ['"]react-router['"]/g, 'from "react-router-dom"');
  if (content !== newContent) {
    fs.writeFileSync(f, newContent);
    console.log('Fixed', f);
  }
});
