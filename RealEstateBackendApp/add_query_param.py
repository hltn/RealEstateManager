import re

def main():
    file_path = r'D:\Jobs\RealEstateManager\RealEstateBackendApp\src\modules\news-fire-crawl-manager\news-fire-crawl-manager.controller.ts'
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # The goal is to insert @ApiQuery or @ApiParam before the method signature.
    # We will find all methods, parse their arguments for @Query or @Param, and add the corresponding decorators before the method (after @ApiOperation, etc.).

    lines = content.split('\n')
    new_lines = []
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check if it's an HTTP decorator
        match = re.match(r'^  @(Get|Post|Put|Delete)\(', line)
        if match:
            # We found an HTTP method. Let's collect lines until we hit the method opening bracket `{`
            # and search for `@Query('name')` or `@Param('name')`
            
            method_lines = []
            j = i + 1
            while j < len(lines) and '{' not in lines[j] and '  @' not in lines[j]:
                method_lines.append(lines[j])
                j += 1
            
            if j < len(lines) and '{' in lines[j]:
                method_lines.append(lines[j])
            
            # extract params
            full_sig = '\n'.join(method_lines)
            
            queries = re.findall(r"@Query\('([^']+)'\)", full_sig)
            params = re.findall(r"@Param\('([^']+)'\)", full_sig)
            
            # Add decorators before the HTTP decorator
            # wait, they can be added right before the current line
            decorators = []
            for q in queries:
                decorators.append(f"  @ApiQuery({{ name: '{q}', required: false }})") # usually query is optional in this file
            for p in params:
                decorators.append(f"  @ApiParam({{ name: '{p}', required: true }})")
            
            # Since we are inserting before `line`, we will just extend `new_lines`
            new_lines.extend(decorators)
        
        new_lines.append(line)
        i += 1

    content = '\n'.join(new_lines)
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

if __name__ == '__main__':
    main()
