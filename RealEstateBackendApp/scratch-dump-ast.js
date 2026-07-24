const { MongoClient, ObjectId } = require('mongodb');
const remark = require('remark');
const remarkGfm = require('remark-gfm');

async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('mongodb');
  const doc = await db.collection('newsarticles').findOne({ _id: new ObjectId('6a62eaafd8fbdbaa3d8d00a5') });
  const tree = remark().use(remarkGfm).parse(doc.content);
  console.log(JSON.stringify(tree, null, 2));
  await client.close();
}
run();
