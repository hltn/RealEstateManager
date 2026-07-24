const { MongoClient } = require('mongodb');
const { cleanMarkdownContent } = require('./dist/utils/content-cleaner.js');

async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('mongodb'); 
  
  const docs = await db.collection('articles').find({ content: { $regex: /xem them|tin lien quan|quang cao/i } }).limit(5).toArray();
  console.log("Found", docs.length, "articles with boilerplate");
  
  for (const doc of docs) {
    console.log("--- BEFORE ---");
    console.log(doc.content.substring(0, 500) + "...");
    const cleaned = cleanMarkdownContent(doc.content);
    console.log("--- AFTER ---");
    console.log(cleaned.substring(0, 500) + "...");
    if (doc.content.length === cleaned.length) {
      console.log("NOTHING CLEANED!");
    } else {
      console.log(`Cleaned ${doc.content.length - cleaned.length} chars`);
    }
  }
  
  if (docs.length === 0) {
    const allDocs = await db.collection('articles').find({ content: { $exists: true } }).limit(5).toArray();
    for (const doc of allDocs) {
      const cleaned = cleanMarkdownContent(doc.content);
      if (doc.content.length === cleaned.length) {
        console.log(`NOTHING CLEANED! (ID: ${doc._id})`);
      } else {
        console.log(`Cleaned ${doc.content.length - cleaned.length} chars (ID: ${doc._id})`);
      }
    }
  }
  
  await client.close();
}
run().catch(console.error);
