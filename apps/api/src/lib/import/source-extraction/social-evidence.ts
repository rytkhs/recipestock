export const hasUsableSocialEvidence = ({
  text,
  referenceImageUrls,
}: {
  text: string;
  referenceImageUrls: readonly string[];
}) => text.trim().length > 0 || referenceImageUrls.length > 0;
