import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://modon-school.com";
  return [
    { url: `${base}/ar/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 1.0 },
    { url: `${base}/en/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/ar/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/ar/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
  ];
}
