"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  FileText,
  ExternalLink,
  Sparkles,
  Timer,
  Volume2,
} from "lucide-react";

export interface AdItem {
  id: string;
  type: "image" | "countdown" | "video" | "document";
  title: string;
  body: string | null;
  bg_color: string | null;
  image_url: string | null;
  target_date: string | null;
  social_url: string | null;
  social_label: string | null;
  video_url: string | null;
  doc_url: string | null;
  effect_type?: string | null;
  reaction_count?: number;
  my_reaction?: string | null;
}

type ReactionType = "like" | "love" | "celebrate" | "seen";

const REACTIONS: { value: ReactionType; emoji: string; label: string }[] = [
  { value: "like", emoji: "👍", label: "إعجاب" },
  { value: "love", emoji: "❤️", label: "حب" },
  { value: "celebrate", emoji: "🎉", label: "احتفال" },
  { value: "seen", emoji: "👀", label: "شوهد" },
];

interface AdsBannerProps {
  ads: AdItem[];
  isAr: boolean;
  onReact?: (adId: string, reaction: ReactionType | null) => void;
}

const EFFECTS_CSS = `
@keyframes ad-float-up {
  0% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(-120px) scale(0.5); opacity: 0; }
}
@keyframes ad-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes ad-pulse-glow {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.1); }
}
@keyframes ad-confetti-fall {
  0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
  100% { transform: translateY(160px) rotate(720deg); opacity: 0; }
}
@keyframes ad-bounce-in {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.05); }
  70% { transform: scale(0.95); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes ad-slide-up {
  0% { transform: translateY(20px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}
@keyframes ad-wiggle {
  0%, 100% { transform: rotate(-3deg); }
  50% { transform: rotate(3deg); }
}
@keyframes ad-countdown-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
@keyframes ad-sparkle-rotate {
  0% { transform: rotate(0deg) scale(1); opacity: 0.7; }
  50% { transform: rotate(180deg) scale(1.3); opacity: 1; }
  100% { transform: rotate(360deg) scale(1); opacity: 0.7; }
}
`;

function FloatingParticles({ type }: { type: AdItem["type"] }) {
  const particles = Array.from({ length: type === "countdown" ? 8 : 6 });
  const icons: Record<string, string[]> = {
    image: ["✨", "⭐", "💫", "🌟", "✦", "◆"],
    countdown: ["⏳", "🔥", "⚡", "💥", "🎯", "⏰", "🚀", "💎"],
    video: ["🎬", "🎥", "▶️", "🌟", "✨", "💫"],
    document: ["📄", "📋", "📎", "✏️", "📌", "⭐"],
  };
  const set = icons[type] || icons.image;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((_, i) => (
        <span
          key={i}
          className="absolute select-none"
          style={{
            left: `${10 + (i * 80) / particles.length}%`,
            top: `${15 + ((i * 37) % 60)}%`,
            animation: `ad-float-up ${3 + (i % 3)}s ease-in-out ${i * 0.5}s infinite`,
            fontSize: `${10 + (i % 3) * 4}px`,
          }}
        >
          {set[i % set.length]}
        </span>
      ))}
    </div>
  );
}

function ConfettiEffect() {
  const colors = [
    "#FF6B6B", "#FFE66D", "#4ECDC4", "#45B7D1",
    "#96E6A1", "#DDA0DD", "#F0A500", "#FF8A5C",
  ];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            width: `${4 + (i % 3) * 2}px`,
            height: `${4 + (i % 3) * 2}px`,
            backgroundColor: colors[i % colors.length],
            left: `${5 + (i * 90) / 20}%`,
            top: "-5px",
            animation: `ad-confetti-fall ${2 + (i % 3) * 0.5}s ease-in ${i * 0.15}s infinite`,
            borderRadius: i % 2 === 0 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}

function ShimmerOverlay() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      <div
        className="absolute inset-0 -skew-x-12"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 100%)",
          animation: "ad-shimmer 3s ease-in-out infinite",
        }}
      />
    </div>
  );
}

function TypeIcon({ type }: { type: AdItem["type"] }) {
  const cls = "h-5 w-5 text-white drop-shadow-md";
  switch (type) {
    case "image":
      return <Sparkles className={cls} />;
    case "countdown":
      return <Timer className={cls} />;
    case "video":
      return <Play className={cls} />;
    case "document":
      return <FileText className={cls} />;
  }
}

function CountdownDisplay({
  targetDate,
  isAr,
}: {
  targetDate: string;
  isAr: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, new Date(targetDate).getTime() - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  const t = (ar: string, en: string) => (isAr ? ar : en);

  const units = [
    { value: days, label: t("يوم", "Day") },
    { value: hours, label: t("ساعة", "Hr") },
    { value: minutes, label: t("دقيقة", "Min") },
    { value: seconds, label: t("ثانية", "Sec") },
  ];

  return (
    <div className="flex gap-2 mt-3" style={{ animation: "ad-slide-up 0.5s ease-out" }}>
      {units.map((u, i) => (
        <div
          key={i}
          className="flex flex-col items-center bg-white/20 backdrop-blur-sm rounded-xl px-2.5 py-1.5 min-w-[48px] border border-white/10"
          style={{ animation: `ad-bounce-in 0.4s ease-out ${i * 0.1}s both` }}
        >
          <span
            className="text-lg sm:text-xl font-black text-white tabular-nums leading-none"
            style={{ animation: "ad-countdown-pulse 2s ease-in-out infinite" }}
          >
            {String(u.value).padStart(2, "0")}
          </span>
          <span className="text-[10px] text-white/70 font-medium mt-0.5">
            {u.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReactionBar({
  ad,
  onReact,
}: {
  ad: AdItem;
  onReact?: (adId: string, reaction: ReactionType | null) => void;
}) {
  if (!onReact) return null;
  return (
    <div className="flex items-center gap-1 mt-2">
      {REACTIONS.map((r) => {
        const isActive = ad.my_reaction === r.value;
        return (
          <button
            key={r.value}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReact(ad.id, isActive ? null : r.value);
            }}
            className="flex items-center gap-0.5 px-2 py-1 rounded-full text-xs font-semibold transition-all active:scale-90"
            style={{
              background: isActive
                ? "rgba(255,255,255,0.35)"
                : "rgba(255,255,255,0.15)",
              color: "white",
              border: isActive
                ? "1px solid rgba(255,255,255,0.5)"
                : "1px solid rgba(255,255,255,0.1)",
            }}
            title={r.label}
          >
            {r.emoji}
          </button>
        );
      })}
      {(ad.reaction_count ?? 0) > 0 && (
        <span className="text-[10px] text-white/60 ms-1 font-medium">
          {ad.reaction_count}
        </span>
      )}
    </div>
  );
}

function AdCard({
  ad,
  active,
  isAr,
  onReact,
}: {
  ad: AdItem;
  active: boolean;
  isAr: boolean;
  onReact?: (adId: string, reaction: ReactionType | null) => void;
}) {
  const [videoOpen, setVideoOpen] = useState(false);
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const Arrow = isAr ? ChevronLeft : ChevronRight;

  const bgGradient = ad.bg_color
    ? `linear-gradient(135deg, ${ad.bg_color} 0%, color-mix(in srgb, ${ad.bg_color} 60%, #1a1a2e) 100%)`
    : "linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)";

  if (ad.type === "image" && ad.image_url) {
    return (
      <div className="relative rounded-2xl overflow-hidden">
        <img
          src={ad.image_url}
          alt={ad.title}
          className="w-full h-[180px] sm:h-[220px] object-cover"
          loading="eager"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 40%, transparent 70%)",
          }}
        />
        <FloatingParticles type="image" />
        <ShimmerOverlay />
        <div
          className="absolute top-3 left-3 bg-white/20 backdrop-blur-md rounded-full p-1.5 border border-white/20"
          style={{ animation: "ad-sparkle-rotate 4s linear infinite" }}
        >
          <TypeIcon type="image" />
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 p-4"
          style={{ animation: active ? "ad-slide-up 0.5s ease-out" : "none" }}
        >
          <h3 className="text-lg sm:text-xl font-black text-white drop-shadow-lg">
            {ad.title}
          </h3>
          {ad.body && (
            <p className="text-sm text-white/85 mt-1 line-clamp-2 drop-shadow">
              {ad.body}
            </p>
          )}
          {ad.social_url && (
            <a
              href={ad.social_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 bg-white/25 backdrop-blur-sm rounded-full px-4 py-1.5 text-sm font-bold text-white hover:bg-white/35 transition-all active:scale-95 border border-white/20"
            >
              {ad.social_label || t("المزيد", "More")}
              <Arrow className="h-3.5 w-3.5" />
            </a>
          )}
          <ReactionBar ad={ad} onReact={onReact} />
        </div>
      </div>
    );
  }

  if (ad.type === "video" && ad.video_url) {
    return (
      <div className="relative rounded-2xl overflow-hidden" style={{ background: bgGradient }}>
        {!videoOpen ? (
          <div className="relative p-5 sm:p-6 min-h-[180px] sm:min-h-[200px] flex flex-col justify-between">
            <FloatingParticles type="video" />
            <ShimmerOverlay />
            <div
              className="absolute top-3 left-3 bg-white/20 backdrop-blur-md rounded-full p-1.5 border border-white/20"
              style={{ animation: "ad-wiggle 2s ease-in-out infinite" }}
            >
              <Volume2 className="h-5 w-5 text-white" />
            </div>
            <div style={{ animation: active ? "ad-slide-up 0.5s ease-out" : "none" }}>
              <h3 className="text-lg sm:text-xl font-black text-white mt-6">
                {ad.title}
              </h3>
              {ad.body && (
                <p className="text-sm text-white/80 mt-1 line-clamp-2">{ad.body}</p>
              )}
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                type="button"
                onClick={() => setVideoOpen(true)}
                className="inline-flex items-center gap-2 bg-white/25 backdrop-blur-sm rounded-full px-5 py-2.5 text-sm font-bold text-white hover:bg-white/35 transition-all active:scale-95 border border-white/20"
                style={{ animation: "ad-pulse-glow 2s ease-in-out infinite" }}
              >
                <Play className="h-4 w-4 fill-white" />
                {t("شاهد الآن", "Watch Now")}
              </button>
              {ad.social_url && (
                <a
                  href={ad.social_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {ad.social_label || t("رابط", "Link")}
                </a>
              )}
            </div>
            <ReactionBar ad={ad} onReact={onReact} />
          </div>
        ) : (
          <div className="relative aspect-video max-h-[280px]">
            <iframe
              src={ad.video_url.replace("watch?v=", "embed/")}
              className="w-full h-full rounded-2xl"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
            <button
              type="button"
              onClick={() => setVideoOpen(false)}
              className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/70 text-lg"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  if (ad.type === "document" && ad.doc_url) {
    return (
      <div className="relative rounded-2xl overflow-hidden" style={{ background: bgGradient }}>
        <div className="relative p-5 sm:p-6 min-h-[160px] flex flex-col justify-between">
          <FloatingParticles type="document" />
          <ShimmerOverlay />
          <div
            className="absolute top-3 left-3 bg-white/20 backdrop-blur-md rounded-full p-1.5 border border-white/20"
            style={{ animation: "ad-wiggle 3s ease-in-out infinite" }}
          >
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div style={{ animation: active ? "ad-slide-up 0.5s ease-out" : "none" }}>
            <h3 className="text-lg sm:text-xl font-black text-white mt-6">
              {ad.title}
            </h3>
            {ad.body && (
              <p className="text-sm text-white/80 mt-1 line-clamp-2">{ad.body}</p>
            )}
          </div>
          <a
            href={ad.doc_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 bg-white/25 backdrop-blur-sm rounded-full px-5 py-2.5 text-sm font-bold text-white hover:bg-white/35 transition-all active:scale-95 border border-white/20 self-start"
          >
            <FileText className="h-4 w-4" />
            {t("عرض المستند", "View Document")}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <ReactionBar ad={ad} onReact={onReact} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ background: bgGradient }}>
      <div className="relative p-5 sm:p-6 min-h-[180px] sm:min-h-[200px]">
        <FloatingParticles type="countdown" />
        <ConfettiEffect />
        <ShimmerOverlay />
        <div
          className="absolute top-3 left-3 bg-white/20 backdrop-blur-md rounded-full p-1.5 border border-white/20"
          style={{ animation: "ad-sparkle-rotate 3s linear infinite" }}
        >
          <TypeIcon type={ad.type} />
        </div>
        <div
          className="absolute -top-16 -right-16 w-40 h-40 rounded-full opacity-[0.08]"
          style={{ background: "white" }}
        />
        <div
          className="absolute -bottom-10 -left-10 w-28 h-28 rounded-full opacity-[0.06]"
          style={{ background: "white" }}
        />
        <div
          className="relative mt-6"
          style={{ animation: active ? "ad-slide-up 0.5s ease-out" : "none" }}
        >
          <h3 className="text-lg sm:text-xl font-black text-white">
            {ad.title}
          </h3>
          {ad.body && (
            <p className="text-sm text-white/80 mt-1 line-clamp-2">{ad.body}</p>
          )}
          {ad.type === "countdown" && ad.target_date && (
            <CountdownDisplay targetDate={ad.target_date} isAr={isAr} />
          )}
          {ad.social_url && (
            <a
              href={ad.social_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 bg-white/25 backdrop-blur-sm rounded-full px-4 py-2 text-sm font-bold text-white hover:bg-white/35 transition-all active:scale-95 border border-white/20"
            >
              {ad.social_label || t("المزيد", "More")}
              <Arrow className="h-3.5 w-3.5" />
            </a>
          )}
          <ReactionBar ad={ad} onReact={onReact} />
        </div>
      </div>
    </div>
  );
}

export function AdsBanner({ ads, isAr, onReact }: AdsBannerProps) {
  const [adIndex, setAdIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const next = useCallback(() => {
    setAdIndex((i) => (i + 1) % ads.length);
  }, [ads.length]);

  const prev = useCallback(() => {
    setAdIndex((i) => (i - 1 + ads.length) % ads.length);
  }, [ads.length]);

  useEffect(() => {
    if (ads.length <= 1) return;
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [ads.length, next]);

  if (ads.length === 0) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null || ads.length <= 1) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (isAr ? diff < 0 : diff > 0) next();
      else prev();
    }
    setTouchStart(null);
  };

  return (
    <>
      <style>{EFFECTS_CSS}</style>
      <div
        className="relative overflow-hidden rounded-2xl shadow-xl"
        style={{ minHeight: "160px" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {ads.map((ad, i) => (
          <div
            key={ad.id}
            className="w-full transition-all duration-700 ease-in-out"
            style={{
              position: i === adIndex ? "relative" : "absolute",
              inset: 0,
              opacity: i === adIndex ? 1 : 0,
              transform:
                i === adIndex
                  ? "scale(1) translateY(0)"
                  : "scale(0.96) translateY(10px)",
              pointerEvents: i === adIndex ? "auto" : "none",
              zIndex: i === adIndex ? 1 : 0,
            }}
          >
            <AdCard ad={ad} active={i === adIndex} isAr={isAr} onReact={onReact} />
          </div>
        ))}

        {ads.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute top-1/2 left-2 -translate-y-1/2 z-10 bg-black/30 backdrop-blur-sm text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/50 transition-all active:scale-90 border border-white/10"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute top-1/2 right-2 -translate-y-1/2 z-10 bg-black/30 backdrop-blur-sm text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/50 transition-all active:scale-90 border border-white/10"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {ads.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
            {ads.map((_, i) => (
              <button
                key={i}
                onClick={() => setAdIndex(i)}
                className="rounded-full transition-all duration-500 shadow-sm"
                style={{
                  width: i === adIndex ? "22px" : "8px",
                  height: "8px",
                  backgroundColor:
                    i === adIndex ? "white" : "rgba(255,255,255,0.45)",
                  boxShadow:
                    i === adIndex ? "0 0 8px rgba(255,255,255,0.5)" : "none",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
