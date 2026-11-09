# Icon Maker Pipeline

Flutter Foundry exposes a unified icon workflow at `/icon-maker` and through the `/mcp` endpoint.

## Capabilities

- Deterministic prompt-driven SVG generation with minimal, geometric, rounded, outline, pixel and abstract styles. English/Arabic concept routing covers the documented icon vocabulary; this is procedural vector generation, not a general image-generation model.
- Multi-style variants, PNG previews, launcher-mask previews and 32/48/64-pixel legibility previews.
- Raster import for PNG, JPEG and WebP. The limited-color rectangle trace preserves partial transparency and is intended for flat artwork/logos, not photo-faithful tracing.
- SVG source editing with stable element IDs; targeted fill, stroke, opacity, stroke-width and transform edits; safe insertion of common vector primitives; attribute removal and element deletion; undo/redo and up to 30 local browser versions.
- SVG validation, sanitizer checks, whitespace optimization, and a headless SVG-Edit compatibility round-trip. The round-trip verifies the official editor API and serialization on the server; use the separate SVG-Edit link for its full interactive editor.
- Heuristic quality checks for canvas ratio, artwork bounds, centering, safe margins, the central Android adaptive-icon safe zone, minimum rendered stroke width, explicit opaque-canvas contrast, element count and approximate palette size. Scores/findings are advisory and do not replace visual review.
- ZIP export containing source SVG, PNG sizes, Android adaptive and legacy icon resources, monochrome and foreground VectorDrawable resources, iOS AppIcon assets with alpha removed using the selected solid background, and Flutter Launcher Icons config/assets. Flutter assets include adaptive foreground/monochrome and iOS dark/tinted source PNGs.
- Local browser undo/redo and up to 30 saved versions using localStorage.
- Expensive browser operations can be cancelled and client requests time out after 65 seconds; server-side work may still be subject to the host's own execution limit.

## Flutter Launcher Icons bundle

The export ZIP contains a `flutter/` directory. Copy the **contents** of that directory into the Flutter project root, merge `flutter/pubspec.yaml.snippet` into the existing `dev_dependencies`, then run:

    flutter pub get
    dart run flutter_launcher_icons

The generated `flutter_launcher_icons.yaml` targets `flutter_launcher_icons: ^0.14.4`. The package configuration includes Android adaptive foreground/background/monochrome assets, iOS alpha removal and optional iOS 18+ dark/tinted source files. Review the selected opaque background and the iOS variants before release.

## MCP tools

- `icon_generate_from_prompt`
- `icon_generate_variants`
- `icon_prepare_editable_svg`
- `icon_edit_elements`
- `icon_analyze_quality`
- `icon_optimize_svg`
- `icon_vectorize_raster`
- `icon_export_bundle`
- `icon_render_custom_svg`
- `svgedit_process_svg`

The custom-SVG renderer uses Sharp locally. No external image-generation API is involved.

## Android VectorDrawable limitations

The Android VectorDrawable exporter supports SVG paths, rectangles, circles, ellipses, lines, polylines, polygons and simple translate/scale/rotate transforms. Unsupported gradients, filters, masks, text, clipping paths and complex transforms produce an explicit error instead of silently flattening the source. PNG exports preserve rendered SVG appearance as the compatibility fallback.

## Quality and preview limitations

The score is heuristic. The 66% safe-zone estimate and stroke/contrast checks are approximations; inherited styles, gradients, textured backgrounds, transparency and unsupported color syntaxes can affect the measurements. Always inspect the generated PNG at real launcher size and test Android masks and iOS appearances on target devices.

## Validation

    npm run typecheck
    npm test
    npm run test:icons:coverage
    npm run test:icon-maker
    npm run lint
    npm run build
    npm run test:svg-edit

## Hosting limitations

The server-side SVG-Edit compatibility check uses headless Chromium and an external official editor build. Vercel's runtime/browser limits and the 60-second route duration still apply. The interactive editor is opened separately; the in-page controls cover common vector editing operations without embedding the full third-party editor.
