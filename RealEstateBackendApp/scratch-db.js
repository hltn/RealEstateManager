const { MongoClient } = require('mongodb');
async function run() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  // We don't know the exact db name, maybe 'nest' or something? Let's check DB name in .env
  const dbName = process.env.DB_NAME || 'real-estate-news'; // guessing based on typical names
  const dbs = await client.db().admin().listDatabases();
  console.log("Databases:", dbs.databases.map(d => d.name));
  
  const db = client.db('real-estate-news'); // try this first
  let count = await db.collection('articles').countDocuments();
  if (count === 0) {
     const db2 = client.db('news-manager'); // try another
     count = await db2.collection('articles').countDocuments();
     if (count > 0) {
        console.log("Found articles in news-manager");
        const docs = await db2.collection('articles').find({ source: 'Cafeland' }).limit(2).toArray();
        console.log("Content 1:", docs[0]?.content);
     }
  } else {
    console.log("Found articles in real-estate-news");
    const docs = await db.collection('articles').find({ source: 'Cafeland' }).limit(2).toArray();
    console.log("Content 1:", docs[0]?.content);
  }
  await client.close();
}
run().catch(console.error);
