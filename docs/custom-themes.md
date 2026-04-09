# Custom Themes

Kechimochi supports managed custom theme packs. A theme pack defines a color palette, chart colors, heatmap tuning, optional background media, optional typography, and optional scoped CSS overrides.

Imported theme packs are copied into Kechimochi's managed storage. The original file is not watched after import.

## Use a Theme Pack

1. Open the Profile tab.
2. In the Appearance card, choose Import Theme Pack to add a JSON or ZIP pack.
3. Select the imported theme from the Theme dropdown.
4. Use Export Theme Pack to save the currently selected built-in theme or custom theme as a reusable ZIP pack.
5. Use Delete Theme to remove the selected custom pack from managed storage.

Notes:
- Desktop builds store imported packs in Kechimochi's app-data theme-packs directory.
- Self-hosted web mode stores imported packs in the server data directory under theme-packs.
- Kechimochi preserves the source filename when possible and adds a suffix only when a collision would occur.

## Theme Pack Format

```json
{
  "version": 1,
  "id": "custom:aurora-coast",
  "name": "Aurora Coast",
  "variables": {
    "surface-base": "#101820",
    "surface-card": "#17263b",
    "surface-card-hover": "#20324a",
    "text-primary": "#f3fbff",
    "text-secondary": "#9ec4d1",
    "accent-primary": "#72f1b8",
    "accent-primary-hover": "#98ffd0",
    "accent-danger": "#ff6b81",
    "accent-interactive": "#67b7ff",
    "accent-highlight": "#ffd166",
    "accent-secondary": "#c792ea",
    "border-subtle": "#31465d",
    "shadow-soft": "0 2px 4px rgba(0,0,0,0.25)",
    "shadow-strong": "0 6px 20px rgba(0,0,0,0.35)",
    "heatmap-hue": "168",
    "heatmap-saturation-base": "36",
    "heatmap-saturation-range": "44",
    "heatmap-lightness-base": "42",
    "heatmap-lightness-range": "28",
    "accent-contrast": "#081018",
    "chart-series-1": "#72f1b8",
    "chart-series-2": "#67b7ff",
    "chart-series-3": "#c792ea",
    "chart-series-4": "#ffd166",
    "chart-series-5": "#ff6b81"
  },
  "background": {
    "type": "video",
    "src": "assets/background.mp4",
    "poster": "assets/poster.webp",
    "fit": "cover",
    "opacity": 0.72,
    "muted": true,
    "loop": true
  },
  "typography": {
    "heading_family": "'Bahnschrift SemiCondensed', 'Arial Narrow', sans-serif"
  },
  "cssOverrides": ".btn { border-radius: 999px; }"
}
```

## Required Fields

- `version`: Must be `1`.
- `id`: Stable unique identifier. Use letters, numbers, colons, underscores, and hyphens. Prefixing with `custom:` is recommended.
- `name`: Display name shown in the UI.
- `variables`: Complete theme token set.
- `background`: Optional image or video background definition.
- `fonts`: Optional bundled or remote font-face definitions.
- `typography`: Optional body, heading, and monospace font families.
- `cssOverrides`: Optional CSS applied only while that theme is active.

## Variable Reference

- `surface-base`: Main app background and darker input surfaces.
- `surface-card`: Card and panel background.
- `surface-card-hover`: Hover and raised panel surface.
- `text-primary`: Main foreground text.
- `text-secondary`: Supporting and muted text.
- `accent-primary`: Primary accent for actions and emphasis.
- `accent-primary-hover`: Hover state paired with `accent-primary`.
- `accent-danger`: Destructive actions and warnings.
- `accent-interactive`: Links, selected states, and interactive highlights.
- `accent-highlight`: Informational highlight chips and caution surfaces.
- `accent-secondary`: Secondary accent used for alternate emphasis.
- `border-subtle`: Default border and divider color.
- `shadow-soft`: Small shadow used on light elevation.
- `shadow-strong`: Larger shadow used on raised surfaces.
- `heatmap-hue`: Base hue for dashboard heatmaps.
- `heatmap-saturation-base`: Starting saturation for heatmap cells.
- `heatmap-saturation-range`: Saturation spread across heatmap intensity.
- `heatmap-lightness-base`: Starting lightness for heatmap cells.
- `heatmap-lightness-range`: Lightness spread across heatmap intensity.
- `accent-contrast`: Text color used on solid accent backgrounds.
- `chart-series-1` to `chart-series-5`: Default chart palette.

## CSS Overrides

`cssOverrides` is optional. When present:
- Rules are automatically scoped to the active theme.
- `:root` and `body` selectors are rewritten to the active theme selector.
- `@media`, `@supports`, `@layer`, and `@keyframes` are supported.
- Unsafe constructs such as `@import`, `javascript:`, and legacy CSS expressions are rejected.

Example:

```css
.card {
  backdrop-filter: blur(10px);
}

@media (max-width: 700px) {
  .profile-avatar-hero {
    width: 84px;
    height: 84px;
  }
}
```

## Optional Background And Typography Fields

- `background.type`: `image` or `video`.
- `background.src`: Absolute URL, data URI, or safe relative asset path inside the pack.
- `background.poster`: Optional fallback poster for video backgrounds.
- `background.fit`: `cover`, `contain`, or `fill`.
- `background.opacity`: Optional overlay opacity from `0` to `1`.
- `background.blur_px`: Optional blur applied to the background media.
- `background.playback_rate`: Optional video speed multiplier.
- `background.loop`: Optional video looping flag.
- `background.muted`: Optional video muted flag.
- `fonts`: Array of `family`, `src`, and optional `weight`, `style`, `format` entries.
- `typography.body_family`: Optional font-family string for body text.
- `typography.heading_family`: Optional font-family string for headings.
- `typography.monospace_family`: Optional font-family string for code-like text.

## Recommended Workflow

1. Export a built-in theme pack from the Profile tab.
2. Rename the exported `id` and `name`.
3. Edit the `variables` block.
4. Re-import the pack and select it from the Appearance dropdown.
5. Add `cssOverrides` only after the palette looks correct without them.
