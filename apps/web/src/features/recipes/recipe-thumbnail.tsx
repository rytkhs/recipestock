import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

const eagerRecipeThumbnailCount = 4;

type RecipeThumbnailProps = {
  alt: string;
  fallback: ReactNode;
  index: number;
  src: string;
};

export const RecipeThumbnail = (props: RecipeThumbnailProps) => (
  <RecipeThumbnailImage key={props.src} {...props} />
);

const RecipeThumbnailImage = ({ alt, fallback, index, src }: RecipeThumbnailProps) => {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  if (status === "failed") {
    return (
      <span
        role="img"
        aria-label={`${alt}の画像を読み込めませんでした`}
        className="flex size-full items-center justify-center"
      >
        {fallback}
      </span>
    );
  }

  return (
    <img
      alt={alt}
      className={cn(
        "size-full object-cover transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none group-hover:scale-105",
        status === "loaded" ? "opacity-100" : "opacity-0",
      )}
      decoding="async"
      loading={index < eagerRecipeThumbnailCount ? "eager" : "lazy"}
      src={src}
      onError={() => setStatus("failed")}
      onLoad={() => setStatus("loaded")}
    />
  );
};
