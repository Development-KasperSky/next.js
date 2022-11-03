import loader from '@next/font/google/loader'
import fetch from 'next/dist/compiled/node-fetch'

jest.mock('next/dist/compiled/node-fetch')

describe('@next/font/google loader', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('URL from options', () => {
    test.each([
      [
        'Inter',
        {},
        'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=optional',
      ],
      [
        'Inter',
        { weight: '400' },
        'https://fonts.googleapis.com/css2?family=Inter:wght@400&display=optional',
      ],
      [
        'Inter',
        { weight: '900', display: 'block' },
        'https://fonts.googleapis.com/css2?family=Inter:wght@900&display=block',
      ],
      [
        'Source_Sans_Pro',
        { weight: '900', display: 'auto' },
        'https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@900&display=auto',
      ],
      [
        'Source_Sans_Pro',
        { weight: '200', style: 'italic' },
        'https://fonts.googleapis.com/css2?family=Source+Sans+Pro:ital,wght@1,200&display=optional',
      ],
      [
        'Roboto_Flex',
        { display: 'swap' },
        'https://fonts.googleapis.com/css2?family=Roboto+Flex:wght@100..1000&display=swap',
      ],
      [
        'Roboto_Flex',
        { display: 'fallback', weight: 'variable', axes: ['opsz'] },
        'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&display=fallback',
      ],
      [
        'Roboto_Flex',
        {
          display: 'optional',
          axes: ['YTUC', 'slnt', 'wdth', 'opsz', 'XTRA', 'YTAS'],
        },
        'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,slnt,wdth,wght,XTRA,YTAS,YTUC@8..144,-10..0,25..151,100..1000,323..603,649..854,528..760&display=optional',
      ],
      [
        'Oooh_Baby',
        { weight: '400' },
        'https://fonts.googleapis.com/css2?family=Oooh+Baby:wght@400&display=optional',
      ],
      [
        'Albert_Sans',
        { weight: 'variable', style: 'italic' },
        'https://fonts.googleapis.com/css2?family=Albert+Sans:ital,wght@1,100..900&display=optional',
      ],
      [
        'Fraunces',
        { weight: 'variable', style: 'italic', axes: ['WONK', 'opsz', 'SOFT'] },
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@1,9..144,100..900,0..100,0..1&display=optional',
      ],
      [
        'Molle',
        { weight: '400' },
        'https://fonts.googleapis.com/css2?family=Molle:ital,wght@1,400&display=optional',
      ],
      [
        'Roboto',
        { weight: ['500', '300', '400'], style: ['normal', 'italic'] },
        'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;1,300;1,400;1,500&display=optional',
      ],
      [
        'Roboto Mono',
        { style: ['italic', 'normal'] },
        'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=optional',
      ],
      [
        'Fraunces',
        {
          style: ['normal', 'italic'],
          axes: ['WONK', 'opsz', 'SOFT'],
        },
        'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1&display=optional',
      ],

      [
        'Poppins',
        { weight: ['900', '400', '100'] },
        'https://fonts.googleapis.com/css2?family=Poppins:wght@100;400;900&display=optional',
      ],
    ])('%s', async (functionName: string, data: any, url: string) => {
      fetch.mockResolvedValue({
        ok: true,
        text: async () => 'OK',
      })
      const { css } = await loader({
        functionName,
        data: [{ adjustFontFallback: false, ...data }],
        config: { subsets: [] },
        emitFontFile: jest.fn(),
        resolve: jest.fn(),
        fs: {} as any,
        isServer: true,
        variableName: 'myFont',
      })
      expect(css).toBe('OK')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledWith(url, expect.any(Object))
    })
  })

  describe('Errors', () => {
    test('Failed to fetch', async () => {
      fetch.mockResolvedValue({
        ok: false,
      })

      await expect(
        loader({
          functionName: 'Alkalami',
          data: [{ weight: '400' }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Failed to fetch font  \`Alkalami\`.
              URL: https://fonts.googleapis.com/css2?family=Alkalami:wght@400&display=optional"
            `)
    })

    test('Missing function name', async () => {
      await expect(
        loader({
          functionName: '', // default import
          data: [],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"@next/font/google has no default export"`
      )
    })

    test('Unknown font', async () => {
      await expect(
        loader({
          functionName: 'Unknown_Font',
          data: [],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Unknown font \`Unknown Font\`"`
      )
    })

    test('Unknown weight', async () => {
      await expect(
        loader({
          functionName: 'Inter',
          data: [{ weight: '123' }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Unknown weight \`123\` for font \`Inter\`.
              Available weights: \`100\`, \`200\`, \`300\`, \`400\`, \`500\`, \`600\`, \`700\`, \`800\`, \`900\`, \`variable\`"
            `)
    })

    test('Missing weight for non variable font', async () => {
      await expect(
        loader({
          functionName: 'Abel',
          data: [],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Missing weight for font \`Abel\`.
              Available weights: \`400\`"
            `)
    })

    test('Unknown style', async () => {
      await expect(
        loader({
          functionName: 'Molle',
          data: [{ weight: '400', style: 'normal' }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Unknown style \`normal\` for font \`Molle\`.
              Available styles: \`italic\`"
            `)
    })

    test('Invalid display value', async () => {
      await expect(
        loader({
          functionName: 'Inter',
          data: [{ display: 'invalid' }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
                      "Invalid display value \`invalid\` for font \`Inter\`.
                      Available display values: \`auto\`, \`block\`, \`swap\`, \`fallback\`, \`optional\`"
                  `)
    })

    test('Setting axes on non variable font', async () => {
      await expect(
        loader({
          functionName: 'Abel',
          data: [{ weight: '400', axes: [] }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Axes can only be defined for variable fonts"`
      )
    })

    test('Setting axes on font without definable axes', async () => {
      await expect(
        loader({
          functionName: 'Lora',
          data: [{ axes: [] }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Font \`Lora\` has no definable \`axes\`"`
      )
    })

    test('Invalid axes value', async () => {
      await expect(
        loader({
          functionName: 'Inter',
          data: [{ axes: true }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Invalid axes value for font \`Inter\`, expected an array of axes.
              Available axes: \`slnt\`"
            `)
    })

    test('Invalid value in axes array', async () => {
      await expect(
        loader({
          functionName: 'Roboto_Flex',
          data: [{ axes: ['INVALID'] }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
              "Invalid axes value \`INVALID\` for font \`Roboto Flex\`.
              Available axes: \`GRAD\`, \`XTRA\`, \`YOPQ\`, \`YTAS\`, \`YTDE\`, \`YTFI\`, \`YTLC\`, \`YTUC\`, \`opsz\`, \`slnt\`, \`wdth\`"
            `)
    })

    test('Variable in weight array', async () => {
      await expect(
        loader({
          functionName: 'Inter',
          data: [{ weight: ['100', 'variable'] }],
          config: { subsets: [] },
          emitFontFile: jest.fn(),
          resolve: jest.fn(),
          fs: {} as any,
          isServer: true,
          variableName: 'myFont',
        })
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `"Unexpected \`variable\` in weight array for font \`Inter\`. You only need \`variable\`, it includes all available weights."`
      )
    })
  })
})
