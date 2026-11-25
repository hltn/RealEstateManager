// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Quy ước đặt tên theo SKILL nodejs-react-mongo-coding-guidelines, mục 1 (mức warn, chưa chặn CI).
      '@typescript-eslint/naming-convention': [
        'warn',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          // Biến và tham số kiểu boolean phải có tiền tố is/has/should (SKILL mục 1), thêm can/did/will/are cho tên tự nhiên như canEdit, didChange. Chưa áp cho thuộc tính DTO/schema vì đổi tên sẽ đổi API và dữ liệu.
          selector: ['variable', 'parameter'],
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'are'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'classMethod',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'lodash', message: 'Import từng hàm (lodash/pick) hoặc dùng lodash-es để tree-shaking.' },
            { name: 'moment', message: 'moment nặng và không tree-shake được; dùng date-fns hoặc Date/Intl.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      // Test dùng mock/jest.fn: expect(service.method) và mock bất đồng bộ không có await là chủ đích.
      'no-console': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  {
    // Controller NestJS khai báo async để giữ hợp đồng trả Promise dù service bên dưới trả đồng bộ.
    files: ['**/*.controller.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
