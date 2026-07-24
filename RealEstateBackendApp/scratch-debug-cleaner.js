const { MongoClient } = require('mongodb');
const { cleanMarkdownContent } = require('./dist/utils/content-cleaner.js');
const remark = require('remark');
const remarkGfm = require('remark-gfm');
const visit = require('unist-util-visit');
const toString = require('mdast-util-to-string');

async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('mongodb'); 
  
  const docs = await db.collection('newsarticles').find({ 
    content: { $regex: /xem thêm|tin liên quan|quảng cáo|chia sẻ/i } 
  }).limit(5).toArray();
  
  console.log("Found", docs.length, "articles with boilerplate keywords");
  
  for (const doc of docs) {
    const cleaned = cleanMarkdownContent(doc.content);
    if (doc.content.length === cleaned.length) {
      console.log(`\nID: ${doc._id} - NOTHING CLEANED!`);
      // Let's dump the AST for headings and paragraphs
      remark().use(remarkGfm).use(() => tree => {
         visit(tree, (node) => {
           if (node.type === 'heading' || node.type === 'paragraph') {
             const text = toString(node).trim();
             if (/xem thêm|tin liên quan|quảng cáo|chia sẻ/i.test(text)) {
                console.log("Found target node type:", node.type);
                console.log("toString output:", JSON.stringify(text));
                console.log("Node structure:", JSON.stringify(node, null, 2));
             }
           }
         });
      }).processSync(doc.content);
    } else {
      console.log(`\nID: ${doc._id} - Cleaned ${doc.content.length - cleaned.length} chars`);
    }
  }
  
  await client.close();
}
run().catch(console.error);
