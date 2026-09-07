export function fireworks(bounds) {
  if (
    !bounds ||
    !bounds.width ||
    !bounds.height ||
    (window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  )
    return () => {};
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "1500"
  });
  context.scale(scale, scale);
  document.body.appendChild(canvas);
  const originX = bounds.left + Math.min(bounds.width * 0.4, 150);
  const originY = bounds.top + bounds.height / 2;
  const colors = [
    "#ffe09a",
    "#ffb65c",
    "#ff728b",
    "#a78bfa",
    "#68e5d0",
    "#f9fff0"
  ];
  const sparks = Array.from({ length: 100 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 100 + Math.random() * 0.12;
    const speed = 65 + Math.random() * 210;
    return {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[index % colors.length],
      size: 0.8 + Math.random() * 1.7,
      life: 0.65 + Math.random() * 0.55,
      twinkle: Math.random() * 6
    };
  });
  let frame,
    stopped = false;
  const cleanup = () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    canvas.remove();
  };
  const start = window.performance.now();
  function draw(now) {
    if (stopped) return;
    const time = (now - start) / 1000;
    context.clearRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    if (time < 0.2) {
      const glow = context.createRadialGradient(
        originX,
        originY,
        0,
        originX,
        originY,
        36
      );
      glow.addColorStop(0, `rgba(255,250,220,${1 - time / 0.2})`);
      glow.addColorStop(1, "rgba(255,180,80,0)");
      context.fillStyle = glow;
      context.fillRect(originX - 36, originY - 36, 72, 72);
    }
    for (const spark of sparks) {
      if (time > spark.life) continue;
      const travel = (1 - Math.exp(-2.5 * time)) / 2.5;
      const previous = Math.max(0, time - 0.035);
      const tail = (1 - Math.exp(-2.5 * previous)) / 2.5;
      const x = originX + spark.vx * travel;
      const y = originY + spark.vy * travel + 65 * time * time;
      context.globalAlpha =
        Math.pow(1 - time / spark.life, 0.65) *
        (0.75 + 0.25 * Math.sin(time * 35 + spark.twinkle));
      context.strokeStyle = spark.color;
      context.lineWidth = spark.size;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(
        originX + spark.vx * tail,
        originY + spark.vy * tail + 65 * previous * previous
      );
      context.lineTo(x, y);
      context.stroke();
      context.fillStyle = spark.color;
      context.beginPath();
      context.arc(x, y, spark.size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    if (time < 1.25) frame = window.requestAnimationFrame(draw);
    else cleanup();
  }
  frame = window.requestAnimationFrame(draw);
  return cleanup;
}
