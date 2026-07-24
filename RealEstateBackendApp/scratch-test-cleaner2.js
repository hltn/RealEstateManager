const { MongoClient } = require('mongodb');
const { cleanMarkdownContent } = require('./dist/utils/content-cleaner.js');

async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('mongodb'); 
  
  const docs = await db.collection('newsarticles').find({ content: { $exists: true } }).limit(20).toArray();
  
  for (const doc of docs) {
    const cleaned = cleanMarkdownContent(doc.content);
    if (doc.content.length !== cleaned.length) {
      console.log(`Cleaned ${doc.content.length - cleaned.length} chars (ID: ${doc._id})`);
    } else {
      console.log(`NOTHING CLEANED! (ID: ${doc._id})`);
    }
  }
  
  await client.close();
}
run().catch(console.error);
