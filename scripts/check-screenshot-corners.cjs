const path = require('node:path')
const { app, nativeImage } = require('electron')

const imagePath = path.resolve(process.argv[2] ?? '')
const sampleSize = 12
const minimumTransparentRatio = 0.85

function inspectCorner(bitmap, width, xOffset, yOffset) {
  let minimumAlpha = 255
  let transparentPixels = 0

  for (let y = 0; y < sampleSize; y += 1) {
    for (let x = 0; x < sampleSize; x += 1) {
      const offset = ((yOffset + y) * width + xOffset + x) * 4
      const alpha = bitmap[offset + 3]
      minimumAlpha = Math.min(minimumAlpha, alpha)
      if (alpha === 0) transparentPixels += 1
    }
  }

  return {
    minimumAlpha,
    transparentRatio: transparentPixels / (sampleSize * sampleSize),
  }
}

app.whenReady().then(() => {
  const image = nativeImage.createFromPath(imagePath)
  if (image.isEmpty()) throw new Error(`Unable to load ${imagePath}`)

  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const corners = {
    'top-left': inspectCorner(bitmap, width, 0, 0),
    'top-right': inspectCorner(bitmap, width, width - sampleSize, 0),
    'bottom-left': inspectCorner(bitmap, width, 0, height - sampleSize),
    'bottom-right': inspectCorner(
      bitmap,
      width,
      width - sampleSize,
      height - sampleSize,
    ),
  }
  const failures = Object.entries(corners)
    .filter(([, result]) => (
      result.transparentRatio < minimumTransparentRatio
    ))
    .map(([name, result]) => (
      `${name}: ${(result.transparentRatio * 100).toFixed(1)}% transparent, `
      + `minimum alpha ${result.minimumAlpha}`
    ))

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    app.exit(1)
    return
  }

  console.log('screenshot-corners: clean')
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
