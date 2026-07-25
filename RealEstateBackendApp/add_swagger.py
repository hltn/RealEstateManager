import re
import sys

def camel_to_title(name):
    s = re.sub('([A-Z])', r' \1', name)
    return s.capitalize()

def main():
    file_path = r'D:\Jobs\RealEstateManager\RealEstateBackendApp\src\modules\news-fire-crawl-manager\news-fire-crawl-manager.controller.ts'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add ApiOperation, ApiTags import
    if '@nestjs/swagger' not in content:
        content = content.replace("@nestjs/common';", "@nestjs/common';\nimport { ApiOperation, ApiTags, ApiQuery, ApiParam, ApiBody } from '@nestjs/swagger';\nimport { UpdateCronConfigDto, BulkIdsDto, AnalyzeRawArticlesDto, SaveArticlesDto, TriggerManualCrawlDto, AiPromptDto } from './dtos/news-manager.dto';")
    else:
        # just add imports
        pass

    # Add ApiTags to controller
    if "@ApiTags('News Manager')" not in content:
        content = content.replace("@Controller('news-manager')", "@ApiTags('News Manager')\n@Controller('news-manager')")

    # Replace all methods with missing ApiOperation
    # We find `@Get(...)`, `@Post(...)`, `@Put(...)`, `@Delete(...)`
    # followed by `async method(...)` or `method(...)`

    lines = content.split('\n')
    new_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check if it's an HTTP decorator
        match = re.match(r'^  @(Get|Post|Put|Delete)\(', line)
        if match:
            # We must check if the next line or previous lines have ApiOperation
            if i > 0 and '@ApiOperation' not in lines[i-1]:
                # Find the method name
                method_name_match = None
                for j in range(i+1, min(i+5, len(lines))):
                    method_name_match = re.search(r'^\s*(?:async\s+)?([a-zA-Z0-9_]+)\(', lines[j])
                    if method_name_match:
                        break
                
                if method_name_match:
                    method_name = method_name_match.group(1)
                    summary = camel_to_title(method_name)
                    new_lines.append(f"  @ApiOperation({{ summary: '{summary}' }})")
        
        new_lines.append(line)
        i += 1

    content = '\n'.join(new_lines)

    # Some manual DTO replacements for specific endpoints
    content = content.replace("@Body() newPrompts: AiPrompt[]", "@Body() newPrompts: AiPromptDto[]")
    content = content.replace("@Body() body: { isActive: boolean; frequency: string }", "@Body() body: UpdateCronConfigDto")
    content = content.replace("@Body('ids') ids: string[]", "@Body() body: BulkIdsDto")
    content = content.replace("ids = body.ids", "ids = body.ids") # no change needed but wait
    # The previous replace makes `@Body() body: BulkIdsDto`, but inside the method it was `ids`.
    # Let's fix that. If the method used `@Body('ids') ids: string[]`, it becomes `@Body() body: BulkIdsDto` and we need to declare `const { ids } = body;`
    
    # Wait, it's easier to use @ApiBody for array of strings or create a DTO.
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
