import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-zoom.ts");
}

test("适配比例把整张图放进视口，且不把小于视口的图放大", async () => {
  const { fitZoom, IMAGE_ZOOM_MIN } = await loadSubject();

  assert.equal(fitZoom({ w: 2000, h: 1000 }, { w: 800, h: 600 }), 0.4);
  assert.equal(fitZoom({ w: 120, h: 90 }, { w: 800, h: 600 }), 1);
  assert.equal(fitZoom({ w: 100000, h: 100000 }, { w: 800, h: 600 }), IMAGE_ZOOM_MIN);
  assert.equal(fitZoom({ w: 0, h: 0 }, { w: 800, h: 600 }), 1);
});

test("缩放比例被限制在 10% 到 800% 之间", async () => {
  const { clampZoom, IMAGE_ZOOM_MIN, IMAGE_ZOOM_MAX } = await loadSubject();

  assert.equal(clampZoom(0.01), IMAGE_ZOOM_MIN);
  assert.equal(clampZoom(32), IMAGE_ZOOM_MAX);
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(Number.NaN), 1);
});

test("以光标为锚点缩放后，光标下方的图像像素不移动", async () => {
  const { zoomCameraAt } = await loadSubject();
  const natural = { w: 1000, h: 500 };
  const viewport = { w: 800, h: 600 };
  const camera = { scale: 0.8, x: 0, y: 100 };
  const anchor = { x: 400, y: 300 };

  const pixelBefore = {
    x: (anchor.x - camera.x) / camera.scale,
    y: (anchor.y - camera.y) / camera.scale,
  };
  const next = zoomCameraAt(camera, anchor, 1.6, natural, viewport);
  const pixelAfter = { x: (anchor.x - next.x) / next.scale, y: (anchor.y - next.y) / next.scale };

  assert.equal(next.scale, 1.6);
  assert.equal(next.x, -400);
  assert.equal(next.y, -100);
  assert.deepEqual(pixelAfter, pixelBefore);
});

test("小于视口的图始终居中，平移不产生位移", async () => {
  const { centerCamera, panCamera } = await loadSubject();
  const natural = { w: 100, h: 50 };
  const viewport = { w: 800, h: 600 };

  assert.deepEqual(centerCamera(natural, viewport, 1), { scale: 1, x: 350, y: 275 });
  assert.deepEqual(panCamera(centerCamera(natural, viewport, 1), 300, -80, natural, viewport), {
    scale: 1,
    x: 350,
    y: 275,
  });
});

test("放大后平移不会把图片拖出视口留下空白", async () => {
  const { panCamera } = await loadSubject();
  const natural = { w: 1000, h: 500 };
  const viewport = { w: 800, h: 600 };
  const camera = { scale: 2, x: 0, y: 0 };

  assert.equal(panCamera(camera, 5000, 5000, natural, viewport).x, 0);
  assert.equal(panCamera(camera, 5000, 5000, natural, viewport).y, 0);
  assert.equal(panCamera(camera, -5000, -5000, natural, viewport).x, 800 - 2000);
  assert.equal(panCamera(camera, -5000, -5000, natural, viewport).y, 600 - 1000);
});

test("尺寸未知时保持相机原样，不产生 NaN", async () => {
  const { clampCamera, centerCamera, isFitCamera } = await loadSubject();
  const camera = { scale: 2, x: 10, y: 20 };

  assert.deepEqual(clampCamera(camera, { w: 0, h: 0 }, { w: 800, h: 600 }), camera);
  assert.deepEqual(clampCamera(camera, { w: 100, h: 100 }, { w: 0, h: 0 }), camera);
  assert.deepEqual(centerCamera({ w: 0, h: 0 }, { w: 800, h: 600 }, 1), {
    scale: 1,
    x: 400,
    y: 300,
  });
  assert.equal(
    isFitCamera({ scale: 0.4, x: 0, y: 0 }, { w: 2000, h: 1000 }, { w: 800, h: 600 }),
    true,
  );
  assert.equal(
    isFitCamera({ scale: 1, x: 0, y: 0 }, { w: 2000, h: 1000 }, { w: 800, h: 600 }),
    false,
  );
});

test("捏合以旧中点为锚，画面不随中点移动漂移", async () => {
  const { pinchCamera } = await loadSubject();
  const natural = { w: 1000, h: 1000 };
  const viewport = { w: 800, h: 600 };
  const camera = { scale: 1, x: 0, y: 0 };
  const previous = { distance: 200, x: 300, y: 200 };
  const next = { distance: 500, x: 350, y: 200 };

  const result = pinchCamera(camera, previous, next, natural, viewport);

  assert.deepEqual(result, { scale: 2.5, x: -400, y: -300 });
  assert.equal((next.x - result.x) / result.scale, (previous.x - camera.x) / camera.scale);
  assert.equal((next.y - result.y) / result.scale, (previous.y - camera.y) / camera.scale);
});

test("捏合缺少有效起始距离时保持相机不变", async () => {
  const { pinchCamera } = await loadSubject();
  const camera = { scale: 2, x: 10, y: 20 };

  assert.deepEqual(
    pinchCamera(
      camera,
      { distance: 0, x: 100, y: 100 },
      { distance: 50, x: 120, y: 100 },
      { w: 100, h: 100 },
      { w: 800, h: 600 },
    ),
    camera,
  );
});
