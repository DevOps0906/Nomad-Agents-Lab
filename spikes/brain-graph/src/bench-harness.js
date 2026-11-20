// URL 파라미터 벤치 모드 공통 측정기.
// ?bench=<노드 수>&seed=<시드>&warmup=<ms>&sample=<ms>&selections=<횟수>
import { BENCH_DEFAULT_SEED, createRandom } from './sample-graph.js';

export const readBenchParams = () => {
  const params = new URLSearchParams(location.search);
  const nodeCount = Number.parseInt(params.get('bench') ?? '', 10);
  if (!Number.isFinite(nodeCount) || nodeCount < 2) return null;
  const number = (key, fallback) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    nodeCount: Math.min(nodeCount, 50000),
    seed: number('seed', BENCH_DEFAULT_SEED),
    warmupMs: number('warmup', 5000),
    sampleMs: number('sample', 8000),
    selections: number('selections', 20),
  };
};

const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const summarize = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(ratio * sorted.length) - 1)];
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const round = (value) => Math.round(value * 100) / 100;
  return { count: values.length, mean: round(mean), p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted.at(-1)) };
};

const readGpu = (renderer) => {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      drawingBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    };
  } catch {
    return null;
  }
};

const showResult = (result) => {
  const panel = document.createElement('pre');
  panel.id = 'bench-result';
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:9999;max-width:min(560px,90vw);max-height:60vh;overflow:auto;margin:0;padding:10px;font:12px/1.4 monospace;color:#d8e2ff;background:rgba(8,12,24,.92);border:1px solid #3a4a72;border-radius:6px;white-space:pre-wrap';
  panel.textContent = JSON.stringify(result, null, 2);
  document.body.append(panel);
};

export const createBenchHarness = ({ params, rendererName, linkCount }) => {
  let sceneStart = 0;
  let firstRenderMs = null;
  let cpuSamples = null;
  let firstRenderResolve;
  const firstRendered = new Promise((resolve) => { firstRenderResolve = resolve; });

  return {
    params,
    markSceneStart() {
      sceneStart = performance.now();
    },
    // 첫 renderer.render() 직후 호출. 다음 프레임 콜백 시점을 화면 표시로 본다.
    markFirstRender() {
      if (firstRenderMs !== null) return;
      firstRenderMs = 0;
      requestAnimationFrame(() => {
        firstRenderMs = performance.now() - sceneStart;
        firstRenderResolve();
      });
    },
    // 애니메이션 루프 한 번의 JS·렌더 제출 시간(ms)
    frame(cpuMs) {
      cpuSamples?.push(cpuMs);
    },
    async run({ renderer, nodeIds, selectByRaycast, extra = () => ({}) }) {
      await firstRendered;
      await wait(params.warmupMs);

      // 프레임 간격(rAF)과 CPU 프레임 시간을 sampleMs 동안 모은다.
      const sampleFrames = async () => {
        const intervals = [];
        const cpu = [];
        cpuSamples = cpu;
        const start = performance.now();
        await new Promise((resolve) => {
          let last = null;
          const tick = (timestamp) => {
            if (last !== null) intervals.push(timestamp - last);
            last = timestamp;
            const elapsed = performance.now() - start;
            if ((elapsed >= params.sampleMs && intervals.length >= 10) || elapsed >= 60000) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        cpuSamples = null;
        return { intervals, cpu };
      };

      const idle = await sampleFrames();
      const intervals = idle.intervals;
      const drawInfo = { calls: renderer.info.render.calls, points: renderer.info.render.points, lines: renderer.info.render.lines };

      const random = createRandom(params.seed + 7);
      const candidates = nodeIds.slice(1);
      const selectionMs = [];
      let hits = 0;
      for (let index = 0; index < params.selections && candidates.length; index += 1) {
        const id = candidates[Math.floor(random() * candidates.length)];
        const t0 = performance.now();
        if (selectByRaycast(id)) hits += 1;
        await nextPaint();
        selectionMs.push(performance.now() - t0);
        await wait(80);
      }

      // 마지막 선택(선택 노드·이웃 라벨 표시)이 유지된 상태의 프레임
      const selected = await sampleFrames();

      const frameInterval = summarize(intervals);
      const result = {
        renderer: rendererName,
        nodes: params.nodeCount,
        links: linkCount,
        seed: params.seed,
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        gpu: readGpu(renderer),
        firstRenderMs: Math.round(firstRenderMs * 10) / 10,
        frameIntervalMs: frameInterval,
        fps: frameInterval ? Math.round((1000 / frameInterval.mean) * 10) / 10 : null,
        cpuFrameMs: summarize(idle.cpu),
        selectedFrameIntervalMs: summarize(selected.intervals),
        selectedCpuFrameMs: summarize(selected.cpu),
        selectionMs: summarize(selectionMs),
        selectionHits: `${hits}/${selectionMs.length}`,
        drawInfo,
        jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
        ...extra(),
      };
      window.__BENCH_RESULT__ = result;
      console.info('[bench]', JSON.stringify(result));
      showResult(result);
      return result;
    },
  };
};
