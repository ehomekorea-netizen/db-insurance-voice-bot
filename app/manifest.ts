import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DB손해보험 AI 보이스 상담봇",
    short_name: "DB보이스봇",
    description: "실시간 음성 및 약관 근거 답변을 결합한 스마트 AI 보험 상담 서비스",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0f1d",
    theme_color: "#0f3fa4",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
