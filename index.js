const cheerio = require('cheerio')
const fse = require('fs-extra')
const ora = require('ora')
const path = require('path')
const stream = require('stream')
const request = require('request')
const resemble = require('node-resemble-v2')
const urlbuilder = require('sane-url-builder')
const urljoin = require('url-join')
const urlparse = require('url-parse')

class Test {
  constructor (testPath, cssSelector) {
    this.testPath = testPath
    this.cssSelector = cssSelector
    this.imageUrls = []
  }
}

module.exports = {
  init: function (options) {
    this.options = options
    this.imagePath= this.options.imagePath || './images'
    this.tests = []
  },

  test: function (urlPath, selector) {
    this.tests.push(new Test(urlPath, selector))
  },

  start: function (test) {
    return new Promise((resolve, reject) => {
      let url = urljoin(this.options.baseUrl, test.testPath)
      let message = `Getting content from page ${url}`
      let spinner = ora({
        text: message,
        spinner: 'earth'
      }).start()

      request(url, (error, response, body) => {
        if (response && response.statusCode === 200) {
          spinner.succeed()

          this.getImages(test, body).then(() => {
            message = `Testing images from page '${url}' with selector '${test.cssSelector}'`
            let spinner = ora({
              text: message,
              spinner: 'monkey'
            }).start()

            this.testImages(test).then(() => {
              test.imageUrls.forEach(imageUrl => {
                let imageSpinner = ora({
                  text: message,
                  spinner: 'dots'
                }).start()

                let result = imageUrl.result

                if (!result) {
                  imageSpinner.fail(`Image ${imageUrl.testImageUrl} has no result 🤔`)
                } else if (!result.isSameDimensions
                  || result.rawMisMatchPercentage > this.options.maxDiffPercentage
                ) {
                  imageSpinner.fail(`Image ${imageUrl.testImageUrl} failed. Same dimensions = ${result.isSameDimensions}, mismatch = ${result.misMatchPercentage}`)
                } else {
                  imageSpinner.succeed(imageUrl.testImageUrl + '👌')
                }
              })

              spinner.info()

              console.log()
            })
          })
        }
      })
    })
  },

  getImages: function (test, body) {
    return new Promise((resolve, reject) => {
      let url = urljoin(this.options.baseUrl, test.testPath)
      let message = `Getting images from page ${url}`
      let spinner = ora({
        text: message,
        spinner: 'monkey'
      }).start()

      let baseHtml = cheerio.load(body)
      let matches = baseHtml(test.cssSelector)

      Object.keys(matches).forEach(key => {
        if (matches[key].attribs && matches[key].attribs[this.options.imageAttribute]) {
          let imageUrl = matches[key].attribs[this.options.imageAttribute]

          if (this.options.liveCdnHost.test(imageUrl)) {
            test.imageUrls.push(this.prepareUrl(imageUrl))
          }
        }
      })

      test.imageUrls.forEach((url, index) => {
        const v1Url = /^\/[a-z]{3,4}\/[0-9]+\/[0-1]+\/[0-1]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\/[a-z]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\/[0-9]+\//i

        let parsed = urlparse(url.fullSizeImageUrl, true)
        let directory = path.resolve(path.join(this.imagePath, path.dirname(parsed.pathname.replace(v1Url, ''))))
        let filename = path.resolve(directory, path.basename(parsed.pathname))

        if (this.options.localTest && !fse.pathExistsSync(filename)) {
          fse.ensureDir(directory).then(() => {
            spinner.text = `Requesting image ${url.fullSizeImageUrl}`
            spinner.start()

            request({
              method: 'GET',
              uri: url.fullSizeImageUrl,
              encoding: null,
              gzip: true
            }, (err, response, body) => {
              if (err) {
                console.log(err)
              }

              let bufferStream = stream.Readable()
              bufferStream.push(body)
              bufferStream.push(null)

              bufferStream.pipe(fse.createWriteStream(filename))
              spinner.stop()
            })
          })
        }

        if ((index + 1) === this.tests.length) {
          spinner.succeed()
          return resolve()
        }
      })
    })
  },

  testImages: function (test) {
    return new Promise((resolve, reject) => {
      test.imageUrls.forEach((imageUrl, index) => {
        let getBaseImage = new Promise((resolve, reject) => {
          request({ method: 'GET', uri: imageUrl.originalImageUrl, encoding: null, gzip: true },
            (err, response, body) => {
              if (err) return reject(err)
              if (response && response.statusCode && response.statusCode === 404) {
                return reject(new Error('Image not found: ' + imageUrl.originalImageUrl))
              }

              return resolve(body)
            }
          ).on('error', err => {
            return reject(err)
          })
        })

        let getTestImage = new Promise((resolve, reject) => {
          request({ method: 'GET', uri: imageUrl.testImageUrl, encoding: null, gzip: true },
            (err, response, body) => {
              if (err) return reject(err)
              if (response && response.statusCode && response.statusCode === 404) {
                return reject(new Error('Image not found: ' + imageUrl.testImageUrl))
              }

              return resolve(body)
            }
          ).on('error', err => {
            return reject(err)
          })
        })

        getBaseImage.then(baseImage => {
          getTestImage.then(testImage => {
            if (baseImage && testImage) {
              resemble(testImage).compareTo(testImage).ignoreAntialiasing().onComplete(data => {
                imageUrl.result = data

                if ((index + 1) === test.imageUrls.length) {
                  return resolve()
                }
              })
            }
          }).catch((err) => {
            console.log(err)
          })
        }).catch((err) => {
          console.log('2', err)
        })
      })
    })
  },

  prepareUrl: function (url) {
    let parsed = urlparse(url, true)
    let builder = new urlbuilder

    builder.protocol('http').host(parsed.host).path(parsed.pathname)

    let original = builder.value()
    let testUrl = builder.clone().host(this.options.testCdnHost).value()
    let fullSizeUrl = builder.path(false).path(this.getFullSizeImageUrl(parsed)).value()

    return {
      originalImageUrl: original,
      fullSizeImageUrl: fullSizeUrl,
      testImageUrl: testUrl
    }
  },

  getFullSizeImageUrl: function (parsedUrl) {
    // version 1 matches a string like /jpg/80/0/0/640/480/ at the beginning of the url
    const v1pattern = /^\/[a-z]{3,4}\/([0-9]+)\/[0-1]+\/[0-1]+\/([0-9]+)\/([0-9]+)\//gi

    let pathname = parsedUrl.pathname
    let match = v1pattern.exec(pathname)

    if (match) {
      let newPathPart = match[0]
      newPathPart = newPathPart.replace(match[1], '0')
      newPathPart = newPathPart.replace(match[2], '0')
      newPathPart = newPathPart.replace(match[3], '0')

      return pathname.replace(match[0], newPathPart)
    }
  },

  go: function () {
    let imageUrls = []
    let runner = Promise.resolve(true)

    this.tests.forEach((test, index) => {
      runner = runner.then(this.start(test).then(result => {
        // urls.forEach(url => {
        //   if (!imageUrls.includes(url)) imageUrls.push(url)
        // })

        if ((index + 1) === this.tests.length) {
          console.log(result)
        }
      }))
    })
  }
}