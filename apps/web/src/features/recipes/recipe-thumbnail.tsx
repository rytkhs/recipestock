import { useState } from "react";

const eagerRecipeThumbnailCount = 4;

type RecipeThumbnailProps = {
  alt: string;
  index: number;
  src: string;
};

export const RecipeThumbnail = ({ alt, index, src }: RecipeThumbnailProps) => {
  const [completedSrc, setCompletedSrc] = useState<string | null>(null);
  const isComplete = completedSrc === src;

  return (
    <img
      alt={alt}
      className={`h-full w-full object-cover transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none group-hover:scale-105 ${
        isComplete ? "opacity-100" : "opacity-0"
      }`}
      decoding="async"
      loading={index < eagerRecipeThumbnailCount ? "eager" : "lazy"}
      src={src}
      onError={() => setCompletedSrc(src)}
      onLoad={() => setCompletedSrc(src)}
    />
  );
};
