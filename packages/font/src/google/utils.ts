import fs from 'fs'
// @ts-ignore
import fetch from 'next/dist/compiled/node-fetch'
import fontData from './font-data.json'
const allowedDisplayValues = ['auto', 'block', 'swap', 'fallback', 'optional']

const formatValues = (values: string[]) =>
  values.map((val) => `\`${val}\``).join(', ')

type FontOptions = {
  fontFamily: string
  weights: string[]
  styles: string[]
  display: string
  preload: boolean
  selectedVariableAxes?: string[]
  fallback?: string[]
  adjustFontFallback: boolean
  variable?: string
  subsets?: string[]
}
export function validateData(functionName: string, data: any): FontOptions {
  let {
    weight,
    style,
    display = 'optional',
    preload = true,
    axes,
    fallback,
    adjustFontFallback = true,
    variable,
    subsets,
  } = data[0] || ({} as any)
  if (functionName === '') {
    throw new Error(`@next/font/google has no default export`)
  }

  const fontFamily = functionName.replace(/_/g, ' ')

  const fontFamilyData = (fontData as any)[fontFamily]
  const fontWeights = fontFamilyData?.weights
  if (!fontWeights) {
    throw new Error(`Unknown font \`${fontFamily}\``)
  }
  const fontStyles = fontFamilyData.styles

  const weights = !weight
    ? []
    : [...new Set(Array.isArray(weight) ? weight : [weight])]
  const styles = !style
    ? []
    : [...new Set(Array.isArray(style) ? style : [style])]

  if (weights.length === 0) {
    // Set variable as default, throw if not available
    if (fontWeights.includes('variable')) {
      weights.push('variable')
    } else {
      throw new Error(
        `Missing weight for font \`${fontFamily}\`.\nAvailable weights: ${formatValues(
          fontWeights
        )}`
      )
    }
  }

  if (weights.length > 1 && weights.includes('variable')) {
    throw new Error(
      `Unexpected \`variable\` in weight array for font \`${fontFamily}\`. You only need \`variable\`, it includes all available weights.`
    )
  }

  weights.forEach((selectedWeight) => {
    if (!fontWeights.includes(selectedWeight)) {
      throw new Error(
        `Unknown weight \`${selectedWeight}\` for font \`${fontFamily}\`.\nAvailable weights: ${formatValues(
          fontWeights
        )}`
      )
    }
  })

  if (styles.length === 0) {
    if (fontStyles.length === 1) {
      styles.push(fontStyles[0])
    } else {
      styles.push('normal')
    }
  }

  styles.forEach((selectedStyle) => {
    if (!fontStyles.includes(selectedStyle)) {
      throw new Error(
        `Unknown style \`${selectedStyle}\` for font \`${fontFamily}\`.\nAvailable styles: ${formatValues(
          fontStyles
        )}`
      )
    }
  })

  if (!allowedDisplayValues.includes(display)) {
    throw new Error(
      `Invalid display value \`${display}\` for font \`${fontFamily}\`.\nAvailable display values: ${formatValues(
        allowedDisplayValues
      )}`
    )
  }

  if (weights[0] !== 'variable' && axes) {
    throw new Error('Axes can only be defined for variable fonts')
  }

  return {
    fontFamily,
    weights,
    styles,
    display,
    preload,
    selectedVariableAxes: axes,
    fallback,
    adjustFontFallback,
    variable,
    subsets,
  }
}

export function getUrl(
  fontFamily: string,
  axes: {
    wght: string[]
    ital: string[]
    variableAxes?: [string, string][]
  },
  display: string
) {
  // Variants are all combinations of weight and style, each variant will result in a separate font file
  const variants: Array<[string, string][]> = []
  for (const wgth of axes.wght) {
    if (axes.ital.length === 0) {
      variants.push([['wght', wgth], ...(axes.variableAxes ?? [])])
    } else {
      for (const ital of axes.ital) {
        variants.push([
          ['ital', ital],
          ['wght', wgth],
          ...(axes.variableAxes ?? []),
        ])
      }
    }
  }

  // Google api requires the axes to be sorted, starting with lowercase words
  if (axes.variableAxes) {
    variants.forEach((variant) => {
      variant.sort(([a], [b]) => {
        const aIsLowercase = a.charCodeAt(0) > 96
        const bIsLowercase = b.charCodeAt(0) > 96
        if (aIsLowercase && !bIsLowercase) return -1
        if (bIsLowercase && !aIsLowercase) return 1

        return a > b ? 1 : -1
      })
    })
  }

  return `https://fonts.googleapis.com/css2?family=${fontFamily.replace(
    / /g,
    '+'
  )}:${variants[0].map(([key]) => key).join(',')}@${variants
    .map((variant) => variant.map(([, val]) => val).join(','))
    .sort()
    .join(';')}&display=${display}`
}

export async function fetchCSSFromGoogleFonts(url: string, fontFamily: string) {
  let mockedResponse: string | undefined
  if (process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES) {
    const mockFile = require(process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES)
    mockedResponse = mockFile[url]
    if (!mockedResponse) {
      throw new Error('Missing mocked response for URL: ' + url)
    }
  }

  let cssResponse
  if (mockedResponse) {
    cssResponse = mockedResponse
  } else {
    const res = await fetch(url, {
      headers: {
        // The file format is based off of the user agent, make sure woff2 files are fetched
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36',
      },
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch font  \`${fontFamily}\`.\nURL: ${url}`)
    }

    cssResponse = await res.text()
  }

  return cssResponse
}

export async function fetchFontFile(url: string) {
  if (process.env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES) {
    if (url.startsWith('/')) {
      return fs.readFileSync(url)
    }
    return Buffer.from(url)
  }
  const arrayBuffer = await fetch(url).then((r: any) => r.arrayBuffer())
  return Buffer.from(arrayBuffer)
}

export function getFontAxes(
  fontFamily: string,
  weights: string[],
  styles: string[],
  selectedVariableAxes?: string[]
): {
  wght: string[]
  ital: string[]
  variableAxes?: [string, string][]
} {
  const allAxes: Array<{ tag: string; min: number; max: number }> = (
    fontData as any
  )[fontFamily].axes
  const hasItalic = styles.includes('italic')
  const hasNormal = styles.includes('normal')
  const ital = hasItalic ? [...(hasNormal ? ['0'] : []), '1'] : []

  // Weights will always contain one element if it's a variable font
  if (weights[0] === 'variable') {
    if (selectedVariableAxes) {
      const defineAbleAxes: string[] = allAxes
        .map(({ tag }) => tag)
        .filter((tag) => tag !== 'wght')
      if (defineAbleAxes.length === 0) {
        throw new Error(`Font \`${fontFamily}\` has no definable \`axes\``)
      }
      if (!Array.isArray(selectedVariableAxes)) {
        throw new Error(
          `Invalid axes value for font \`${fontFamily}\`, expected an array of axes.\nAvailable axes: ${formatValues(
            defineAbleAxes
          )}`
        )
      }
      selectedVariableAxes.forEach((key) => {
        if (!defineAbleAxes.some((tag) => tag === key)) {
          throw new Error(
            `Invalid axes value \`${key}\` for font \`${fontFamily}\`.\nAvailable axes: ${formatValues(
              defineAbleAxes
            )}`
          )
        }
      })
    }

    let weightAxis: string
    const variableAxes: [string, string][] = []
    for (const { tag, min, max } of allAxes) {
      if (tag === 'wght') {
        weightAxis = `${min}..${max}`
      } else if (selectedVariableAxes?.includes(tag)) {
        variableAxes.push([tag, `${min}..${max}`])
      }
    }

    return {
      wght: [weightAxis!],
      ital,
      variableAxes,
    }
  } else {
    return {
      ital,
      wght: weights,
    }
  }
}
