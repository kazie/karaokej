import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/', 'dist-server/', '.histoire/', 'coverage/', 'node_modules/', 'data/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      // Catches e.g. a watchEffect (which runs immediately) touching a `let` declared further down.
      '@typescript-eslint/no-use-before-define': [
        'error',
        { functions: false, classes: true, variables: true, typedefs: false },
      ],
    },
  },
  prettier,
)
