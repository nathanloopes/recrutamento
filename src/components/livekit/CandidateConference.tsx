/**
 * CandidateConference — versão do prefab <VideoConference /> do
 * @livekit/components-react que usa AspectAwareGrid, para que o
 * candidato veja os tiles com a proporção real da câmera (Meet/Zoom
 * style) em vez do grid retangular default.
 */

import { useState } from "react";
import {
  ControlBar,
  Chat,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  ConnectionStateToast,
  useCreateLayoutContext,
  useTracks,
  formatChatMessageLinks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { AspectAwareGrid } from "./AspectAwareGrid";
import { useIsMobile } from "@/hooks/use-mobile";

export function CandidateConference() {
  const [widgetState, setWidgetState] = useState<{
    showChat: boolean;
    unreadMessages: number;
    showSettings?: boolean;
  }>({ showChat: false, unreadMessages: 0, showSettings: false });

  const layoutContext = useCreateLayoutContext();
  const trackRefs = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const isMobile = useIsMobile();

  return (
    <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
      <div className="lk-video-conference" style={{ height: "100%" }}>
        <div
          className="lk-video-conference-inner"
          style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <AspectAwareGrid
              tracks={trackRefs}
              renderTile={(tr) => <ParticipantTile trackRef={tr} />}
            />
          </div>
          <div style={{ flexShrink: 0 }}>
            <ControlBar
              controls={{
                microphone: true,
                camera: true,
                screenShare: !isMobile,
                chat: true,
                leave: true,
              }}
              variation={isMobile ? "minimal" : "verbose"}
            />
          </div>
        </div>
        <Chat
          style={{ display: widgetState.showChat ? "grid" : "none" }}
          messageFormatter={formatChatMessageLinks}
        />
      </div>
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </LayoutContextProvider>
  );
}
