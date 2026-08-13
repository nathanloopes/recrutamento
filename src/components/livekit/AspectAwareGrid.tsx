/**
 * AspectAwareGrid — grid de tiles LiveKit que dimensiona cada tile pela
 * proporção real do MediaStreamTrack (igual Google Meet / Zoom).
 *
 * Diferente do <GridLayout> default do @livekit/components-react (que dá
 * a cada tile uma célula 1fr do container e aplica width/height 100% no
 * <video>), aqui o wrapper de cada tile tem exatamente `w x h` na
 * proporção do vídeo. Assim `object-fit: cover` funciona sem cortar e
 * sem letterbox interno — as faixas pretas (quando existem) vêm do
 * container do grid, não do vídeo.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ParticipantTile, TrackRefContext } from "@livekit/components-react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { TrackEvent } from "livekit-client";

// ─── util ───────────────────────────────────────────────────────────────
const FALLBACK_ASPECT = 16 / 9;
const GAP_PX = 4;

function trackId(t: TrackReferenceOrPlaceholder): string {
  const sid = t.publication?.trackSid;
  const src = t.source ?? "";
  return `${t.participant.identity}:${src}:${sid ?? "placeholder"}`;
}

/**
 * Hook que retorna o aspect ratio (width/height) atual de um track.
 * Ordem de fontes: publication.dimensions → <video>.videoWidth/Height →
 * mediaStreamTrack.getSettings(). Reage a VideoDimensionsChanged.
 */
function useTrackAspect(trackRef: TrackReferenceOrPlaceholder): number {
  const [aspect, setAspect] = useState<number>(() => {
    const d = trackRef.publication?.dimensions;
    if (d && d.width && d.height) return d.width / d.height;
    return FALLBACK_ASPECT;
  });

  useEffect(() => {
    const pub = trackRef.publication;
    const track = pub?.track;

    const read = () => {
      const d = pub?.dimensions;
      if (d && d.width && d.height) {
        setAspect(d.width / d.height);
        return;
      }
      const mst = track?.mediaStreamTrack;
      if (mst) {
        try {
          const s = mst.getSettings();
          if (s.width && s.height) {
            setAspect(s.width / s.height);
            return;
          }
          if (typeof s.aspectRatio === "number" && s.aspectRatio > 0) {
            setAspect(s.aspectRatio);
            return;
          }
        } catch {
          /* ignore */
        }
      }
    };

    read();

    if (!track) return;
    const handler = () => read();
    track.on(TrackEvent.VideoDimensionsChanged, handler);
    track.on(TrackEvent.Muted, handler);
    track.on(TrackEvent.Unmuted, handler);
    return () => {
      track.off(TrackEvent.VideoDimensionsChanged, handler);
      track.off(TrackEvent.Muted, handler);
      track.off(TrackEvent.Unmuted, handler);
    };
  }, [trackRef.publication, trackRef.publication?.track]);

  return aspect || FALLBACK_ASPECT;
}

// ─── best-fit ───────────────────────────────────────────────────────────
/**
 * Escolhe cols/rows e devolve o tamanho (w,h) de cada tile, maximizando
 * a área total ocupada sem cortar nada. Cada tile respeita seu próprio
 * aspect ratio.
 */
function computeLayout(
  containerW: number,
  containerH: number,
  aspects: number[],
  gap: number,
): { cols: number; rows: number; sizes: Array<{ w: number; h: number }> } {
  const n = aspects.length;
  if (n === 0 || containerW <= 0 || containerH <= 0) {
    return { cols: 1, rows: 1, sizes: [] };
  }

  let best = {
    cols: 1,
    rows: n,
    sizes: [] as Array<{ w: number; h: number }>,
    score: -1,
  };

  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (containerW - gap * (cols + 1)) / cols;
    const cellH = (containerH - gap * (rows + 1)) / rows;
    if (cellW <= 0 || cellH <= 0) continue;

    const sizes = aspects.map((a) => {
      // maior retângulo com essa proporção que cabe na célula
      let w = Math.min(cellW, cellH * a);
      let h = w / a;
      if (h > cellH) {
        h = cellH;
        w = h * a;
      }
      return { w, h };
    });
    const score = sizes.reduce((acc, s) => acc + s.w * s.h, 0);
    if (score > best.score) best = { cols, rows, sizes, score };
  }

  return best;
}

// ─── componente ─────────────────────────────────────────────────────────
export interface AspectAwareGridProps {
  tracks: TrackReferenceOrPlaceholder[];
  /**
   * Render function para overlays / children customizados por tile
   * (equivalente ao filho de <GridLayout>). Se omitido, renderiza um
   * <ParticipantTile /> simples.
   */
  renderTile?: (trackRef: TrackReferenceOrPlaceholder) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function AspectAwareGrid({
  tracks,
  renderTile,
  className,
  style,
}: AspectAwareGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: "#000",
        overflow: "hidden",
        ...style,
      }}
    >
      <AspectAwareGridInner
        tracks={tracks}
        w={size.w}
        h={size.h}
        renderTile={renderTile}
      />
    </div>
  );
}

function AspectAwareGridInner({
  tracks,
  w,
  h,
  renderTile,
}: {
  tracks: TrackReferenceOrPlaceholder[];
  w: number;
  h: number;
  renderTile?: (trackRef: TrackReferenceOrPlaceholder) => ReactNode;
}) {
  // Precisa chamar hooks em ordem estável — usamos um sub-componente por
  // track para poder chamar useTrackAspect() lá dentro.
  const [aspectMap, setAspectMap] = useState<Record<string, number>>({});

  const layout = useMemo(() => {
    const aspects = tracks.map((t) => aspectMap[trackId(t)] ?? FALLBACK_ASPECT);
    return computeLayout(w, h, aspects, GAP_PX);
  }, [tracks, aspectMap, w, h]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
        gridAutoRows: "1fr",
        gap: `${GAP_PX}px`,
        padding: `${GAP_PX}px`,
        placeItems: "center",
      }}
    >
      {tracks.map((tr, i) => {
        const id = trackId(tr);
        const sz = layout.sizes[i];
        return (
          <TileCell
            key={id}
            trackRef={tr}
            width={sz?.w ?? 0}
            height={sz?.h ?? 0}
            onAspect={(a) =>
              setAspectMap((m) => (m[id] === a ? m : { ...m, [id]: a }))
            }
            renderTile={renderTile}
          />
        );
      })}
    </div>
  );
}

function TileCell({
  trackRef,
  width,
  height,
  onAspect,
  renderTile,
}: {
  trackRef: TrackReferenceOrPlaceholder;
  width: number;
  height: number;
  onAspect: (aspect: number) => void;
  renderTile?: (trackRef: TrackReferenceOrPlaceholder) => ReactNode;
}) {
  const aspect = useTrackAspect(trackRef);
  useEffect(() => {
    onAspect(aspect);
  }, [aspect, onAspect]);

  return (
    <div
      className="aa-tile"
      style={{
        width: width > 0 ? `${width}px` : "100%",
        height: height > 0 ? `${height}px` : "100%",
        position: "relative",
        overflow: "hidden",
        borderRadius: "0.5rem",
        backgroundColor: "#000",
      }}
    >
      <TrackRefContext.Provider value={trackRef}>
        {renderTile ? (
          renderTile(trackRef)
        ) : (
          <ParticipantTile trackRef={trackRef} />
        )}
      </TrackRefContext.Provider>
    </div>
  );
}
