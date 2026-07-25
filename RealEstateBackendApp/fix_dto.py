import re

def main():
    file_path = r'D:\Jobs\RealEstateManager\RealEstateBackendApp\src\modules\news-fire-crawl-manager\news-fire-crawl-manager.controller.ts'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find @Body() body: BulkIdsDto and insert const { ids } = body;
    pattern = r'(async\s+\w+\(\s*@Body\(\)\s*body:\s*BulkIdsDto\s*\)\s*\{\s*)(try\s*\{)?'
    # We can inject `const { ids } = body;` right after the opening brace `{`.
    def replacer(match):
        prefix = match.group(1)
        try_block = match.group(2) if match.group(2) else ""
        return prefix + try_block + "\n    const { ids } = body;\n"
    
    new_content = re.sub(pattern, replacer, content)

    # Let's fix analyzeRawArticlesDto
    new_content = new_content.replace("@Body('articles') articles: any[]", "@Body() body: AnalyzeRawArticlesDto")
    pattern2 = r'(async\s+\w+\(\s*@Body\(\)\s*body:\s*AnalyzeRawArticlesDto\s*\)\s*\{\s*)(try\s*\{)?'
    def replacer2(match):
        prefix = match.group(1)
        try_block = match.group(2) if match.group(2) else ""
        return prefix + try_block + "\n    const { articles } = body;\n"
    
    new_content = re.sub(pattern2, replacer2, new_content)

    # Fix SaveArticlesDto
    new_content = new_content.replace("@Body() articles: any[]", "@Body() body: SaveArticlesDto")
    pattern3 = r'(async\s+saveArticles\(\s*@Body\(\)\s*body:\s*SaveArticlesDto\s*\)\s*\{\s*)(try\s*\{)?'
    def replacer3(match):
        prefix = match.group(1)
        try_block = match.group(2) if match.group(2) else ""
        return prefix + try_block + "\n    const { articles } = body;\n"
    
    new_content = re.sub(pattern3, replacer3, new_content)

    # Fix triggerManualCrawl
    trigger_old = "    @Body('days') days?: number,\n    @Body('startDate') startDate?: string,\n    @Body('endDate') endDate?: string\n  ) {\n    try {"
    trigger_new = "    @Body() body: TriggerManualCrawlDto,\n  ) {\n    try {\n      const { days, startDate, endDate } = body;"
    new_content = new_content.replace(trigger_old, trigger_new)
    
    trigger_old2 = "    @Body('days') days?: number,\n    @Body('startDate') startDate?: string,\n    @Body('endDate') endDate?: string\n  ) {\n    this.logger.log("
    trigger_new2 = "    @Body() body: TriggerManualCrawlDto,\n  ) {\n    const { days, startDate, endDate } = body;\n    this.logger.log("
    new_content = new_content.replace(trigger_old2, trigger_new2)

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == '__main__':
    main()
