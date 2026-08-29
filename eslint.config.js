import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'web-ui/dist/**',
      'coverage/**',
      '**/*.sqlite',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}', 'src/**/*.ts', 'scripts/**/*.ts', 'worker/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web-ui/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      // First-pass lint: unused leftovers stay visible without failing CI.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      // Path sanitizers and binary parsers match C0 bytes on purpose.
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
);
