const { MongoClient, ObjectId } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  const db = client.db('mongodb');
  const docs = await db.collection('newsarticles').find({ content: { $exists: true, $ne: '' } }).toArray();
  console.log(docs.map(d=>({id: d._id, len: d.content?.length})));
  if (docs.length > 1) {
    console.log(docs[1].content);
  }
  await client.close();
}
run();
