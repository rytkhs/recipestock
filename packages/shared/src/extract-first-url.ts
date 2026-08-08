const trailingUrlDelimiterPattern = /[.,!?:;。、！？：；>\]}）］｝】」』》〉]+$/u;

const trimTrailingUrlDelimiters = (url: string) => {
  let trimmedUrl = url.replace(trailingUrlDelimiterPattern, "");
  const openingParentheses = [...trimmedUrl].filter((character) => character === "(").length;
  let closingParentheses = [...trimmedUrl].filter((character) => character === ")").length;

  while (trimmedUrl.endsWith(")") && closingParentheses > openingParentheses) {
    trimmedUrl = trimmedUrl.slice(0, -1).replace(trailingUrlDelimiterPattern, "");
    closingParentheses -= 1;
  }

  return trimmedUrl;
};

export const extractFirstUrl = (text: string) => {
  const candidate = text.match(/https?:\/\/\S+/i)?.[0];
  return candidate ? trimTrailingUrlDelimiters(candidate) : "";
};
