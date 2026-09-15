// Client-side SVG -> PNG rasterization, used for both the diagram "Download PNG" button and the
// PNG upload that precedes DOCX export. Ported 1:1 from webapp/static/documents.js.

export function svgToPngDataUrl(svg: SVGSVGElement): Promise<string> {
  return new Promise((resolve, reject) => {
    let { width, height } = svg.getBoundingClientRect();
    if (!width || !height) {
      const vb = svg.viewBox && svg.viewBox.baseVal;
      if (vb && vb.width && vb.height) {
        width = vb.width;
        height = vb.height;
      }
    }
    if (!width || !height) {
      width = 900;
      height = 600;
    }

    const svgString = new XMLSerializer().serializeToString(svg);
    const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable.");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to rasterize diagram to PNG."));
    img.src = svgDataUrl;
  });
}

export function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
