const remark = require('remark');
const remarkGfm = require('remark-gfm');
const visit = require('unist-util-visit');

const markdown = `
# Xem thêm

Bài viết này rất hay.

Quảng cáo
`;

const file = remark()
  .use(remarkGfm)
  .use(() => (tree) => {
    const nodesToRemove = new Set();
    visit(tree, (node) => {
      if (node.type === 'heading' && node.children && node.children[0].value === 'Xem thêm') {
        nodesToRemove.add(node);
      }
      if (node.type === 'paragraph' && node.children && node.children[0].value === 'Quảng cáo') {
        nodesToRemove.add(node);
      }
    });

    visit(tree, (node) => {
      if (node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          if (nodesToRemove.has(node.children[i])) {
            node.children.splice(i, 1);
          }
        }
      }
    });
  })
  .processSync(markdown);

console.log("Result:", String(file));
