import antfu from '@antfu/eslint-config'

export default antfu({
  typescript: true,
  rules: {
    'style/arrow-parens': 'off',
    'no-console': 'off',
    'ts/consistent-type-imports': 'off',
    'eslint-comments/no-unlimited-disable': 'off',
    'unused-imports/no-unused-vars': 'off',
  },
})
