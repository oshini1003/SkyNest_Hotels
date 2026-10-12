import { useState } from "react";

const servicePhotos = [
  [/\b(?:airport|transfer|transport|shuttle|taxi)\b/, "service-airport-transfer.webp"],
  [/\b(?:laundry|dry cleaning|wash|ironing)\b/, "service-laundry.webp"],
  [/\bmini\s*bar\b/, "service-minibar.webp"],
  [/\b(?:room service|in room dining)\b/, "service-room-service.webp"],
  [/\bbreakfast\b/, "service-breakfast.webp"],
  [/\b(?:spa|massage|wellness)\b/, "service-spa.jpg"],
  [/\b(?:dining|restaurant|food|lunch|dinner)\b/, "service-dining.jpg"],
];

function servicePhoto(name) {
  const normalized = String(name ?? "").toLowerCase().replace(/[-_\s]+/g, " ").trim();
  const file = servicePhotos.find(([pattern]) => pattern.test(normalized))?.[1]
    ?? "service-hospitality.webp";
  return `/images/hotel/${file}`;
}

export default function ServicePhoto({ name, className, fallbackClassName, fallback, children }) {
  const src = servicePhoto(name);
  const [failedSource, setFailedSource] = useState(null);
  const failed = failedSource === src;

  return (
    <div className={`${className}${failed ? ` ${fallbackClassName}` : ""}`}>
      {failed ? fallback : (
        <img key={src} src={src} alt="" loading="lazy" decoding="async"
          onError={() => setFailedSource(src)} />
      )}
      {children}
    </div>
  );
}
