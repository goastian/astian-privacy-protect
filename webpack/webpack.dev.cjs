const { merge } = require('webpack-merge')
const common = require('./webpack.common.cjs')

module.exports = merge(common, {
  devtool: 'source-map',
  mode: 'development',
  stats: 'errors-warnings',
})
