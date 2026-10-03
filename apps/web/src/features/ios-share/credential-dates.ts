const parseDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const formatDate = (date: Date, now: Date) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();

  return date.getFullYear() === now.getFullYear()
    ? `${month}月${day}日`
    : `${date.getFullYear()}年${month}月${day}日`;
};

/** 連携キーを発行した日。読めない値はnull。 */
export const formatCredentialDay = (value: string) => {
  const date = parseDate(value);
  return date ? formatDate(date, new Date()) : null;
};

/** どのキーをもう使っていないかを見分けられるよう、近い日は言葉にする。読めない値はnull。 */
export const formatCredentialUsedDay = (value: string) => {
  const date = parseDate(value);
  if (!date) return null;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return "今日";
  if (isSameDay(date, yesterday)) return "昨日";
  return formatDate(date, now);
};
