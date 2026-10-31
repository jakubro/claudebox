# Diagrams, maps and models

Three kinds of fenced block draw as pictures instead of code: Mermaid diagrams, GeoJSON and TopoJSON maps, and ASCII STL models. Each one carries a toggle back to its highlighted source and a copy button that takes the raw source, and one that cannot be drawn says so, in a notice above its own source naming the reason - rather than vanishing or leaving a blank frame.

That last point matters more than it sounds. A silently-failed diagram reads as an answer the agent never gave.

## Diagrams

A ` ```mermaid ` fence renders as a diagram - whatever diagram types the bundled Mermaid supports, which is most of what [Mermaid](https://mermaid.js.org/) documents - drawn in the same typeface as the conversation.

- Click a diagram to open it in a zoom and pan overlay, which opens showing the whole thing at its natural size rather than stretched to fill.
- Zoom, fit and directional controls sit in the overlay's corner. `+`, `-` and the arrow keys do the same, the wheel zooms about the pointer, and dragging pans.

![A Mermaid diagram opened in the zoom overlay, its controls in the corner](images/diagrams-mermaid-zoom.png)

## Maps

A ` ```geojson ` or ` ```topojson ` fence draws its shapes on a map fitted to them. The map starts on a plain background and asks nothing of any server until you press its **Load map** button, which adds OpenStreetMap tiles to that one map. Zoom with its controls, a double-click or a pinch, drag to pan, and click a shape to read its properties; the wheel keeps scrolling the conversation.

![A delivery zone, its route and its stops drawn on a plain background, the zoom controls in one corner and the Load map button in the other](images/diagrams-map.png)

## 3D models

A ` ```stl ` fence holding an ASCII STL model draws as a shaded model fitted to the view. Drag to rotate it, right-drag or `Shift`-drag to pan, and zoom with its controls or a pinch; a reset control returns to the opening view. It draws in the browser alone, with no request to any server.

![A tapered spacer drawn as a shaded 3D model, its zoom and reset controls beneath it](images/diagrams-model.png)

## Details

- [Mermaid diagrams](../SPEC.md#314-mermaid-diagrams), [maps](../SPEC.md#3141-maps), [3D models](../SPEC.md#3142-3d-models) - the full behavior contract
- [Rendering](rendering.md) - markdown, math, callouts, links and diffs
