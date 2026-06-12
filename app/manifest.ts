import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "동목포 오멘토",
    short_name: "동목포 오멘토",
    description: "동목포 PA님들의 영업을 지원하는 멘토",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F4EA",
    theme_color: "#2F766D",
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
