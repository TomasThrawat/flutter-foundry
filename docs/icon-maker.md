# Icon Maker Pipeline

Flutter Foundry exposes a unified icon workflow at /icon-maker and through the /mcp endpoint.

## Capabilities

- Prompt-driven deterministic SVG generation with minimal, geometric, rounded, outline, pixel and abstract styles. Common send/paper-plane, trash and phone concepts are recognized in English and Arabic; unsupported subjects deliberately fall back to abstract geometry rather than claiming semantic image understanding. The procedural generator does not call a paid image API.
- Multi-style variants from one prompt, with PNG previews for direct comparison.
- SVG element preparation with stable IDs and targeted safe edits. Only selected elements are changed; supported operations are set attributes, remove attributes and remove element.
- Automated heuristic quality report for viewBox shape, visible artwork bounds, margins, centering, element count and approximate rendered palette size. The UI also previews common launcher masks and 32/48/64-pixel legibility. Scores and findings are advisory.
- SVG validation and whitespace optimization.
- Raster import for PNG, JPEG and WebP. The conversion uses a limited-color, low-resolution rectangle trace and preserves quantized pixel transparency as SVG fill opacity. It is intended for flat artwork and pixel-style graphics, not photo-faithful vector tracing.
- ZIP export with source SVG, multiple PNG sizes, Android adaptive icon resources, monochrome and foreground VectorDrawable resources, legacy density PNGs and an iOS AppIcon asset catalog.
- Local browser undo/redo and up to 30 saved versions using localStorage.

## MCP tools

- icon_generate_from_prompt
- icon_generate_variants
- icon_prepare_editable_svg
- icon_edit_elements
- icon_analyze_quality
- icon_optimize_svg
- icon_vectorize_raster
- icon_export_bundle
- icon_render_custom_svg
- svgedit_process_svg

The custom-SVG renderer accepts fully authored SVG and rasterizes it locally with Sharp. No external image-generation API is involved.

## Android vector export limitations

The Android VectorDrawable exporter supports SVG paths, rectangles, circles, ellipses, lines, polylines, polygons and simple translate/scale/rotate transforms. Unsupported features such as gradients, filters, masks, text, clipping paths and complex transforms produce an explicit error. The export does not silently rasterize those features into the vector resource. PNG outputs preserve the rendered SVG appearance and are included as alternatives.

## Quality and preview limitations

The quality score is based on heuristic raster measurements. Transparent canvases are measured from visible pixels; opaque canvases estimate the background from the rendered border rather than the most frequent color across the whole image. Complex gradients, textured borders and multicolor full-bleed artwork can still make this estimate less useful. Always review the PNG at real launcher size and test Android adaptive masks or iOS assets in the target platform.

## Validation

    npm run typecheck
    npm test
    npm run test:icons:coverage
    npm run lint
    npm run build
    npm run test:svg-edit


## Remaining format boundaries

- Android VectorDrawable export remains intentionally strict. Unsupported gradients, masks, filters, clipping paths, text and complex transforms return an explicit error instead of generating a vector resource with altered appearance. The PNG exports preserve the rendered SVG as the compatibility fallback.

- Prompt interpretation is deterministic keyword/concept routing with authored vector geometry; it is not a general image model. Review the preview and SVG before shipping.
