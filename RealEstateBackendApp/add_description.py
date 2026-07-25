import os
import re

def main():
    directory = r'D:\Jobs\RealEstateManager\RealEstateBackendApp\src'
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.controller.ts'):
                file_path = os.path.join(root, file)
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                # Replace @ApiOperation({ summary: 'xyz' }) with @ApiOperation({ summary: 'xyz', description: 'xyz' })
                pattern = r"@ApiOperation\(\{\s*summary:\s*'([^']+)'\s*\}\)"
                
                def replacer(match):
                    val = match.group(1)
                    return f"@ApiOperation({{ summary: '{val}', description: '{val}' }})"
                
                new_content = re.sub(pattern, replacer, content)
                
                if new_content != content:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated {file_path}")

if __name__ == '__main__':
    main()
