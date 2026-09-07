// Keep the collapsed handle inside the work area, including on secondary displays.
function dockEdge(bounds, areas, threshold = 10) {
  for (const area of areas) {
    if (
      bounds.x < area.x - threshold ||
      bounds.y < area.y - threshold ||
      bounds.x + bounds.width > area.x + area.width + threshold ||
      bounds.y + bounds.height > area.y + area.height + threshold
    )
      continue;
    for (const [edge, distance] of [
      ["left", Math.abs(bounds.x - area.x)],
      ["right", Math.abs(bounds.x + bounds.width - area.x - area.width)],
      ["top", Math.abs(bounds.y - area.y)],
      ["bottom", Math.abs(bounds.y + bounds.height - area.y - area.height)]
    ])
      if (distance <= threshold) return { edge, area };
  }
  return null;
}
function handleBounds(bounds, dock) {
  const { edge, area } = dock;
  const vertical = edge === "left" || edge === "right";
  const width = vertical ? 12 : 72;
  const height = vertical ? 72 : 12;
  return {
    x: vertical
      ? edge === "left"
        ? area.x
        : area.x + area.width - width
      : Math.round(
          Math.max(
            area.x,
            Math.min(
              bounds.x + (bounds.width - width) / 2,
              area.x + area.width - width
            )
          )
        ),
    y: vertical
      ? Math.round(
          Math.max(
            area.y,
            Math.min(
              bounds.y + (bounds.height - height) / 2,
              area.y + area.height - height
            )
          )
        )
      : edge === "top"
      ? area.y
      : area.y + area.height - height,
    width,
    height
  };
}
function contains(bounds, point) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}
module.exports = { dockEdge, handleBounds, contains };
