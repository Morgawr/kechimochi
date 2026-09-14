# Bundled fonts

Kechimochi ships its UI fonts to comply with GDPR.

Each file is the **latin subset, variable weight** build (`wght` axis, 100–900), which covers every
weight the UI uses in a single file. No italic build is bundled — italics are synthesised by the
browser.

| Family | File | Size | Upstream | License |
| --- | --- | --- | --- | --- |
| Inter | `inter-variable.woff2` | 48 KB | [rsms/inter](https://github.com/rsms/inter) | [OFL 1.1](LICENSES/Inter-OFL.txt) |
| Montserrat | `montserrat-variable.woff2` | 38 KB | [JulietaUla/Montserrat](https://github.com/JulietaUla/Montserrat) | [OFL 1.1](LICENSES/Montserrat-OFL.txt) |
| Nunito | `nunito-variable.woff2` | 39 KB | [googlefonts/nunito](https://github.com/googlefonts/nunito) | [OFL 1.1](LICENSES/Nunito-OFL.txt) |
| Source Sans 3 | `source-sans-3-variable.woff2` | 29 KB | [adobe-fonts/source-sans](https://github.com/adobe-fonts/source-sans) | [OFL 1.1](LICENSES/SourceSans3-OFL.txt) |

All four are licensed under the SIL Open Font License 1.1. The license text is identical in each
file, but the copyright notices differ, so every family carries its own copy as the OFL requires.

Obtained from [Fontsource](https://fontsource.org) `@fontsource-variable/<family>` v5.3.0:

```
https://cdn.jsdelivr.net/npm/@fontsource-variable/<family>/files/<family>-latin-wght-normal.woff2
https://cdn.jsdelivr.net/npm/@fontsource-variable/<family>/LICENSE
```

The `@font-face` declarations live in `src/fonts.css`; the user-facing picker is in
Profile → Appearance.
