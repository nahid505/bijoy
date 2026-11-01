import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "বিজয় লেনদেন",
    short_name: "বিজয় লেনদেন",
    description: "বাংলায় ব্যবসার হিসাব, ইআরপি ও লেনদেন ব্যবস্থাপনা",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#059669",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
