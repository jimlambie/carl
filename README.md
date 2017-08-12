# CARL (CDN's Automatic Regression Library)

## Installation

`$ npm install carl --save`

## Usage

Create a test file called `index.js` or `test.js` or `whatever.js`. Require CARL and add some tests:

```js
const carl = require('carl')

// give Carl some instructions
const config = {
  baseUrl: 'http://live-site.com',
  liveCdnHost: /^\/\/live-site\.media/,
  testCdnHost: 'localhost:8101',
  localTest: true,
  imagePath: './images',
  imageAttribute: 'data-src',
  maxDiffPercentage: 2
}

carl.init(config)

// add a test, passing URL and CSS selector
carl.test('/', '.image')

// start
carl.go()
```

Run the tests with, for example:

`$ node whatever.js`
