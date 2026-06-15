/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
// This file is used by webpack to get a list of html pages to copy to the dist
// directory. That is why this isn't typescript and uses commonjs exports

const fs = require('fs')
const path = require('path')

const pages = fs
  .readdirSync(__dirname, { withFileTypes: true })
  .filter((file) => file.isFile())
  .map((file) => file.name)
  .filter((file) => path.extname(file) === '.html')

module.exports = pages
