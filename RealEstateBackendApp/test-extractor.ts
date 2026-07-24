import { ArticleExtractorUtil } from './src/utils/article-extractor.util';

async function run() {
  console.log('Testing extraction...');
  try {
    const markdown = await ArticleExtractorUtil.extractArticle('https://vnexpress.net/chung-cu-ha-noi-tang-gia-manh-4740120.html');
    console.log(markdown.substring(0, 500) + '\n...');
    console.log('Test successful');
  } catch(e) {
    console.error(e);
  }
}
run();
