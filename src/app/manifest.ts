import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: brand.name,
    short_name: brand.name,
    description: "Your projects, reference files, and AI tasks in one workspace.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#151b26",
    theme_color: "#151b26",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
