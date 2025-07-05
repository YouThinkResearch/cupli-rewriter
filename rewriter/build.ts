await Bun.build({
  entrypoints: ['./src/bun-handler.ts'],
  outdir: './dist',
  target: 'bun', // default
})

export { }