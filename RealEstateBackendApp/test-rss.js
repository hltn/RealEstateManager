const Parser = require('rss-parser');
const axios = require('axios');
const https = require('https');

async function test() {
  const parser = new Parser({
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    requestOptions: {
      rejectUnauthorized: false,
    },
  });

  const url = 'https://moc.gov.vn/rss/1176/tin-chi-dao--dieu-hanh.rss';
  try {
    const rssResponse = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      timeout: 30000,
      responseType: 'text',
    });

    const cleanXml = rssResponse.data
      .replace(/^\uFEFF/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim();

    let xmlStartIndex = cleanXml.indexOf('<?xml');
    if (xmlStartIndex === -1) {
      xmlStartIndex = cleanXml.indexOf('<rss');
    }
    if (xmlStartIndex === -1) {
      xmlStartIndex = cleanXml.indexOf('<feed');
    }

    const finalXml = xmlStartIndex >= 0 ? cleanXml.substring(xmlStartIndex) : cleanXml;
    
    console.log("Snippet:", finalXml.substring(0, 200));

    const feed = await parser.parseString(finalXml);
    console.log("Success! Items:", feed.items.length);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
